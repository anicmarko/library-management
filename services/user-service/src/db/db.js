const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');
const { defineUserModel } = require('../models/userModel');

let sequelize = null;
let User = null;
let isConnected = false;

/**
 * Create Sequelize instance
 */
function createSequelizeInstance() {
  const config = {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    dialect: 'mysql',
    logging: (msg) => logger.debug(msg),
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    retry: {
      max: 3,
    },
  };

  return new Sequelize(
    process.env.MYSQL_DATABASE || 'usersdb',
    process.env.MYSQL_USER || 'library',
    process.env.MYSQL_PASSWORD || 'library',
    config
  );
}

/**
 * Connect to MySQL database
 */
async function connectDB() {
  if (isConnected) {
    logger.info('Already connected to MySQL');
    return;
  }

  try {
    sequelize = createSequelizeInstance();

    await sequelize.authenticate();
    logger.info('MySQL connection established successfully', {
      database: process.env.MYSQL_DATABASE || 'usersdb',
      host: process.env.MYSQL_HOST || 'localhost',
    });

    // Define models
    User = defineUserModel(sequelize);

    // Sync models
    await sequelize.sync({ alter: true });
    logger.info('Database models synchronized');

    isConnected = true;
  } catch (error) {
    logger.error('Unable to connect to MySQL', { error: error.message });
    
    // Retry connection after delay
    logger.info('Retrying database connection in 5 seconds...');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return connectDB();
  }
}

/**
 * Disconnect from database
 */
async function disconnectDB() {
  if (sequelize) {
    await sequelize.close();
    isConnected = false;
    logger.info('MySQL connection closed');
  }
}

/**
 * Get connection status
 */
function getConnectionStatus() {
  return {
    connected: isConnected,
    dialect: 'mysql',
    database: process.env.MYSQL_DATABASE || 'usersdb',
  };
}

/**
 * Get User model
 */
function getUserModel() {
  if (!User) {
    throw new Error('Database not initialized. Call connectDB first.');
  }
  return User;
}

/**
 * Get Sequelize instance
 */
function getSequelize() {
  if (!sequelize) {
    throw new Error('Database not initialized. Call connectDB first.');
  }
  return sequelize;
}

module.exports = {
  connectDB,
  disconnectDB,
  getConnectionStatus,
  getUserModel,
  getSequelize,
};
