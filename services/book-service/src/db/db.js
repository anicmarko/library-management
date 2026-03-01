const mongoose = require('mongoose');
const logger = require('../utils/logger');
const Book = require('../models/bookModel');

let isConnected = false;

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/library-books';
    
    await mongoose.connect(mongoURI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    isConnected = true;
    logger.info('MongoDB connected successfully', { database: mongoose.connection.name });

    await seedDatabase();

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error', { error: err.message });
      isConnected = false;
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
      isConnected = false;
    });

  } catch (error) {
    isConnected = false;
    logger.error('MongoDB connection failed', { error: error.message });
    throw error;
  }
};

const seedDatabase = async () => {
  try {
    const count = await Book.countDocuments();
    
    if (count === 0) {
      const sampleBooks = [
        {
          title: 'The Great Gatsby',
          author: 'F. Scott Fitzgerald',
          isbn: '978-0743273565',
          available: true
        },
        {
          title: 'To Kill a Mockingbird',
          author: 'Harper Lee',
          isbn: '978-0061120084',
          available: true
        },
        {
          title: '1984',
          author: 'George Orwell',
          isbn: '978-0451524935',
          available: true
        }
      ];

      await Book.insertMany(sampleBooks);
      logger.info('Database seeded with sample books', { count: sampleBooks.length });
    }
  } catch (error) {
    logger.error('Error seeding database', { error: error.message });
  }
};

const getConnectionStatus = () => {
  return isConnected && mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
};

const disconnectDB = async () => {
  try {
    await mongoose.connection.close();
    isConnected = false;
    logger.info('MongoDB disconnected gracefully');
  } catch (error) {
    logger.error('Error disconnecting from MongoDB', { error: error.message });
  }
};

module.exports = {
  connectDB,
  disconnectDB,
  getConnectionStatus
};
