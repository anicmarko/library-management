require('dotenv').config();
const express = require('express');
const logger = require('./utils/logger');
const { requestLogger } = require('./utils/logger');
const { connectDB, getConnectionStatus, disconnectDB, getUserModel } = require('./db/db');
const publisher = require('./messaging/publisher');
const subscriber = require('./messaging/subscriber');

const app = express();
const PORT = process.env.PORT || 3003;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'user-service',
    timestamp: new Date().toISOString(),
    db: getConnectionStatus()
  });
});

app.get('/users', async (req, res) => {
  try {
    const User = getUserModel();
    
    // Only return active users
    const users = await User.findAll({
      where: { active: true },
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'name', 'email', 'active', 'loanCount', 'createdAt', 'updatedAt']
    });
    
    res.json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    logger.error('Error fetching users', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.get('/users/:id', async (req, res) => {
  try {
    const User = getUserModel();
    const user = await User.findByPk(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    logger.error('Error fetching user', { error: error.message, userId: req.params.id });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.post('/users', async (req, res) => {
  try {
    const User = getUserModel();
    const { name, email } = req.body;

    if (!name || !email) {
      const details = {};
      if (!name) details.name = 'Name is required';
      if (!email) details.email = 'Email is required';

      return res.status(422).json({
        success: false,
        error: 'Validation failed',
        details
      });
    }

    // Check email uniqueness
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'Email already exists',
        details: { email: 'This email is already registered' }
      });
    }

    const user = await User.create({
      name,
      email,
      active: true,
      loanCount: 0
    });

    await publisher.publishUserCreated(user);

    logger.info('User created successfully', { 
      userId: user.id, 
      name: user.name,
      email: user.email 
    });

    res.status(201).json({
      success: true,
      data: user
    });

  } catch (error) {
    logger.error('Error creating user', { error: error.message });

    if (error.name === 'SequelizeValidationError') {
      const details = {};
      error.errors.forEach(err => {
        details[err.path] = err.message;
      });
      return res.status(422).json({
        success: false,
        error: 'Validation failed',
        details
      });
    }

    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        success: false,
        error: 'Email already exists',
        details: { email: 'This email is already registered' }
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.put('/users/:id', async (req, res) => {
  try {
    const User = getUserModel();
    const { name, email, active } = req.body;
    
    const user = await User.findByPk(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const changes = {};
    
    if (name !== undefined && name !== user.name) {
      changes.name = { from: user.name, to: name };
      user.name = name;
    }
    
    if (email !== undefined && email !== user.email) {
      // Check email uniqueness
      const existingUser = await User.findOne({ 
        where: { email },
        attributes: ['id']
      });
      
      if (existingUser && existingUser.id !== user.id) {
        return res.status(409).json({
          success: false,
          error: 'Email already exists',
          details: { email: 'This email is already registered' }
        });
      }
      
      changes.email = { from: user.email, to: email };
      user.email = email;
    }
    
    if (active !== undefined && active !== user.active) {
      changes.active = { from: user.active, to: active };
      user.active = active;
    }

    await user.save();

    if (Object.keys(changes).length > 0) {
      await publisher.publishUserUpdated(user, changes);
    }

    logger.info('User updated successfully', { 
      userId: user.id,
      changes 
    });

    res.json({
      success: true,
      data: user
    });

  } catch (error) {
    logger.error('Error updating user', { error: error.message, userId: req.params.id });

    if (error.name === 'SequelizeValidationError') {
      const details = {};
      error.errors.forEach(err => {
        details[err.path] = err.message;
      });
      return res.status(422).json({
        success: false,
        error: 'Validation failed',
        details
      });
    }

    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        success: false,
        error: 'Email already exists',
        details: { email: 'This email is already registered' }
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

const startServer = async () => {
  try {
    await connectDB();
    logger.info('Database connection established');

    await publisher.connect();
    logger.info('RabbitMQ publisher initialized');

    subscriber.startSubscribing().catch(err => {
      logger.error('Failed to start subscriber', { error: err.message });
    });

    const server = app.listen(PORT, () => {
      logger.info(`User service listening on port ${PORT}`);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received, shutting down gracefully`);
      
      server.close(async () => {
        logger.info('HTTP server closed');
        
        await publisher.closeConnection();
        await subscriber.closeConnection();
        await disconnectDB();
        
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
};

// Start server only if not in test mode
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

module.exports = app;
