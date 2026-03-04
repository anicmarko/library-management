const { Sequelize } = require('sequelize');
const path = require('path');
const logger = require('../utils/logger');

const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '../../data/notifications.db');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: (msg) => logger.debug(msg)
});

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    logger.info('SQLite connected successfully', { path: dbPath });

    await sequelize.sync({ alter: true });
    logger.info('Database schema synced');
  } catch (error) {
    logger.error('SQLite connection failed', { error: error.message });
    throw error;
  }
};

const disconnectDB = async () => {
  try {
    await sequelize.close();
    logger.info('SQLite disconnected');
  } catch (error) {
    logger.error('Error disconnecting from SQLite', { error: error.message });
  }
};

module.exports = { sequelize, connectDB, disconnectDB };
