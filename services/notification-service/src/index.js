require('dotenv').config();
const express = require('express');
const logger = require('./utils/logger');
const { requestLogger } = require('./utils/logger');
const { connectDB, disconnectDB } = require('./db/db');
const subscriber = require('./messaging/subscriber');
const Notification = require('./models/notificationModel');
const { Op } = require('sequelize');
const { register, metricsMiddleware } = require('./metrics');

const app = express();
const PORT = process.env.PORT || 3004;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use(metricsMiddleware);

app.get('/health', async (req, res) => {
  try {
    const totalNotifications = await Notification.count();
    const unreadCount = await Notification.count({ where: { read: false } });

    res.json({
      status: 'ok',
      service: 'notification-service',
      timestamp: new Date().toISOString(),
      totalNotifications,
      unreadCount
    });
  } catch (error) {
    logger.error('Health check error', { error: error.message });
    res.status(500).json({ status: 'error', service: 'notification-service' });
  }
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.get('/notifications', async (req, res) => {
  try {
    const { eventType, read, limit = 50 } = req.query;
    const where = {};

    if (eventType) {
      where.eventType = eventType;
    }

    if (read !== undefined) {
      where.read = read === 'true';
    }

    const notifications = await Notification.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: Math.min(parseInt(limit, 10) || 50, 500)
    });

    res.json({
      success: true,
      count: notifications.length,
      data: notifications
    });
  } catch (error) {
    logger.error('Error fetching notifications', { error: error.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/notifications/:id', async (req, res) => {
  try {
    const notification = await Notification.findByPk(req.params.id);

    if (!notification) {
      return res.status(404).json({ success: false, error: 'Notification not found' });
    }

    res.json({ success: true, data: notification });
  } catch (error) {
    logger.error('Error fetching notification', { error: error.message, id: req.params.id });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.put('/notifications/:id/read', async (req, res) => {
  try {
    const notification = await Notification.findByPk(req.params.id);

    if (!notification) {
      return res.status(404).json({ success: false, error: 'Notification not found' });
    }

    await notification.update({ read: true });

    res.json({ success: true, data: notification });
  } catch (error) {
    logger.error('Error marking notification as read', { error: error.message, id: req.params.id });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.delete('/notifications/read', async (req, res) => {
  try {
    const deleted = await Notification.destroy({ where: { read: true } });

    res.json({ success: true, deleted });
  } catch (error) {
    logger.error('Error deleting read notifications', { error: error.message });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

let server;

/* istanbul ignore next */
const start = async () => {
  try {
    await connectDB();

    subscriber.startSubscribing().catch((err) => {
      logger.warn('RabbitMQ subscriber failed to start (non-fatal)', { error: err.message });
    });

    server = app.listen(PORT, () => {
      logger.info(`Notification service running on port ${PORT}`, { port: PORT });
    });
  } catch (error) {
    logger.error('Failed to start notification service', { error: error.message });
    process.exit(1);
  }
};

/* istanbul ignore next */
const shutdown = async (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);
  if (server) server.close();
  await subscriber.closeConnection();
  await disconnectDB();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (process.env.NODE_ENV !== 'test') {
  start();
}

module.exports = app;
