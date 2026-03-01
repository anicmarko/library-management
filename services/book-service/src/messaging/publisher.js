const amqp = require('amqplib');
const logger = require('../utils/logger');

const EXCHANGE_NAME = 'library.events';
const EXCHANGE_TYPE = 'topic';
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAY_MS = 3000;

let connection = null;
let channel = null;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const connect = async (retryCount = 0) => {
  try {
    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
    
    connection = await amqp.connect(rabbitmqUrl);
    channel = await connection.createChannel();
    
    await channel.assertExchange(EXCHANGE_NAME, EXCHANGE_TYPE, {
      durable: true
    });

    logger.info('RabbitMQ publisher connected successfully', { exchange: EXCHANGE_NAME });

    connection.on('error', (err) => {
      logger.error('RabbitMQ connection error', { error: err.message });
    });

    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed, attempting to reconnect');
      setTimeout(() => connect(), RETRY_DELAY_MS);
    });

    return { connection, channel };

  } catch (error) {
    logger.error(`RabbitMQ connection attempt ${retryCount + 1} failed`, { error: error.message });
    
    if (retryCount < MAX_RETRY_ATTEMPTS - 1) {
      logger.info(`Retrying in ${RETRY_DELAY_MS}ms...`);
      await sleep(RETRY_DELAY_MS);
      return connect(retryCount + 1);
    } else {
      logger.error('Max retry attempts reached. Could not connect to RabbitMQ');
      throw error;
    }
  }
};

const publishEvent = async (routingKey, payload) => {
  try {
    if (!channel) {
      logger.warn('No active channel, attempting to connect...');
      await connect();
    }

    const message = {
      ...payload,
      timestamp: new Date().toISOString()
    };

    const published = channel.publish(
      EXCHANGE_NAME,
      routingKey,
      Buffer.from(JSON.stringify(message)),
      {
        persistent: true,
        contentType: 'application/json'
      }
    );

    if (published) {
      logger.info('Event published', { routingKey, bookId: payload.bookId });
    } else {
      logger.warn('Event not published - channel buffer full', { routingKey });
    }

    return published;

  } catch (error) {
    logger.error('Failed to publish event', { 
      routingKey, 
      error: error.message,
      payload 
    });
    throw error;
  }
};

const publishBookCreated = async (book) => {
  return publishEvent('book.created', {
    bookId: book._id.toString(),
    title: book.title,
    author: book.author,
    isbn: book.isbn
  });
};

const publishBookUpdated = async (book) => {
  return publishEvent('book.updated', {
    bookId: book._id.toString(),
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    available: book.available
  });
};

const publishBookDeleted = async (bookId, title) => {
  return publishEvent('book.deleted', {
    bookId: bookId.toString(),
    title
  });
};

const closeConnection = async () => {
  try {
    if (channel) {
      await channel.close();
    }
    if (connection) {
      await connection.close();
    }
    logger.info('RabbitMQ publisher connection closed gracefully');
  } catch (error) {
    logger.error('Error closing RabbitMQ publisher connection', { error: error.message });
  }
};

module.exports = {
  connect,
  publishBookCreated,
  publishBookUpdated,
  publishBookDeleted,
  closeConnection
};
