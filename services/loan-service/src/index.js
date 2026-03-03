require('dotenv').config();
const express = require('express');
const logger = require('./utils/logger');
const { requestLogger } = require('./utils/logger');
const { connectDB, getConnectionStatus, disconnectDB, getLoanModel } = require('./db/db');
const publisher = require('./messaging/publisher');
const subscriber = require('./messaging/subscriber');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'loan-service',
    timestamp: new Date().toISOString(),
    db: getConnectionStatus()
  });
});

app.get('/loans', async (req, res) => {
  try {
    const Loan = getLoanModel();
    const { status } = req.query;
    const filter = {};

    if (status) {
      if (status !== 'active' && status !== 'returned') {
        return res.status(422).json({
          success: false,
          error: 'Validation failed',
          details: { status: 'Status must be either active or returned' }
        });
      }
      filter.status = status;
    }

    const loans = await Loan.findAll({
      where: filter,
      order: [['createdAt', 'DESC']]
    });
    
    res.json({
      success: true,
      count: loans.length,
      data: loans
    });
  } catch (error) {
    logger.error('Error fetching loans', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.get('/loans/:id', async (req, res) => {
  try {
    const Loan = getLoanModel();
    const loan = await Loan.findByPk(req.params.id);

    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Loan not found'
      });
    }

    res.json({
      success: true,
      data: loan
    });
  } catch (error) {
    logger.error('Error fetching loan', { error: error.message, loanId: req.params.id });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.post('/loans', async (req, res) => {
  try {
    const Loan = getLoanModel();
    const { bookId, userId, dueDate } = req.body;

    if (!bookId || !userId || !dueDate) {
      const details = {};
      if (!bookId) details.bookId = 'Book ID is required';
      if (!userId) details.userId = 'User ID is required';
      if (!dueDate) details.dueDate = 'Due date is required';

      return res.status(422).json({
        success: false,
        error: 'Validation failed',
        details
      });
    }

    if (subscriber.isBookDeleted(bookId)) {
      return res.status(422).json({
        success: false,
        error: 'Validation failed',
        details: { bookId: 'Cannot create loan for deleted book' }
      });
    }

    const parsedDueDate = new Date(dueDate);
    if (Number.isNaN(parsedDueDate.getTime())) {
      return res.status(422).json({
        success: false,
        error: 'Validation failed',
        details: { dueDate: 'Due date must be a valid date' }
      });
    }

    const loan = await Loan.create({
      bookId: String(bookId),
      userId: Number.parseInt(userId),
      dueDate: parsedDueDate,
      status: 'active'
    });

    await publisher.publishLoanCreated(loan);

    logger.info('Loan created successfully', { 
      loanId: loan.id, 
      bookId: loan.bookId,
      userId: loan.userId 
    });

    res.status(201).json({
      success: true,
      data: loan
    });

  } catch (error) {
    logger.error('Error creating loan', { error: error.message });

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

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.put('/loans/:id/return', async (req, res) => {
  try {
    const Loan = getLoanModel();
    const loan = await Loan.findByPk(req.params.id);

    if (!loan) {
      return res.status(404).json({
        success: false,
        error: 'Loan not found'
      });
    }

    if (loan.status === 'returned') {
      return res.status(409).json({
        success: false,
        error: 'Loan already returned'
      });
    }

    loan.status = 'returned';
    loan.returnedAt = new Date();
    await loan.save();

    await publisher.publishLoanReturned(loan);

    logger.info('Loan returned successfully', { 
      loanId: loan.id, 
      bookId: loan.bookId 
    });

    res.json({
      success: true,
      data: loan
    });

  } catch (error) {
    logger.error('Error returning loan', { error: error.message, loanId: req.params.id });
    
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
      logger.info(`Loan service started on port ${PORT}`);
    });

    const gracefulShutdown = async (signal) => {
      logger.info(`${signal} received, starting graceful shutdown`);
      
      server.close(async () => {
        logger.info('HTTP server closed');
        
        try {
          await publisher.closeConnection();
          await subscriber.closeConnection();
          await disconnectDB();
          logger.info('All connections closed successfully');
          process.exit(0);
        } catch (error) {
          logger.error('Error during shutdown', { error: error.message });
          process.exit(1);
        }
      });

      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
};

if (require.main === module) {
  startServer();
}

module.exports = app;
