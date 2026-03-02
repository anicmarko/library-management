const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');
const defineLoanModel = require('../models/loanModel');

let sequelize = null;
let Loan = null;
let isConnected = false;

const connectDB = async () => {
  try {
    const databaseUrl = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/loansdb';
    
    sequelize = new Sequelize(databaseUrl, {
      dialect: 'postgres',
      logging: (msg) => logger.debug(msg),
      pool: {
        max: 10,
        min: 0,
        acquire: 30000,
        idle: 10000
      }
    });

    await sequelize.authenticate();
    isConnected = true;
    logger.info('PostgreSQL connected successfully', { database: sequelize.config.database });

    Loan = defineLoanModel(sequelize);

    await sequelize.sync({ alter: true });
    logger.info('Database synchronized successfully');

  } catch (error) {
    isConnected = false;
    logger.error('PostgreSQL connection failed', { error: error.message });
    throw error;
  }
};

const getConnectionStatus = () => {
  if (!isConnected || !sequelize) {
    return { connected: false, message: 'Not connected to database' };
  }

  return {
    connected: true,
    dialect: sequelize.getDialect(),
    database: sequelize.config.database
  };
};

const disconnectDB = async () => {
  try {
    if (sequelize) {
      await sequelize.close();
      isConnected = false;
      logger.info('PostgreSQL connection closed');
    }
  } catch (error) {
    logger.error('Error closing PostgreSQL connection', { error: error.message });
    throw error;
  }
};

const getLoanModel = () => {
  if (!Loan) {
    throw new Error('Database not initialized. Call connectDB() first.');
  }
  return Loan;
};

module.exports = {
  connectDB,
  getConnectionStatus,
  disconnectDB,
  getLoanModel,
  getSequelize: () => sequelize
};
