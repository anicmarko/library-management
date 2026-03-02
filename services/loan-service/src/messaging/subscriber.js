const amqp = require('amqplib');
const logger = require('../utils/logger');

const EXCHANGE_NAME = 'library.events';
const EXCHANGE_TYPE = 'topic';
const QUEUE_NAME = 'loan-service-queue';
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAY_MS = 3000;

const deletedBooks = new Set();

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

    await channel.assertQueue(QUEUE_NAME, {
      durable: true
    });

    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'book.deleted');

    logger.info('RabbitMQ subscriber connected successfully', { 
      exchange: EXCHANGE_NAME,
      queue: QUEUE_NAME 
    });

    connection.on('error', (err) => {
      logger.error('RabbitMQ subscriber connection error', { error: err.message });
    });

    connection.on('close', () => {
      logger.warn('RabbitMQ subscriber connection closed, attempting to reconnect');
      setTimeout(() => startSubscribing(), RETRY_DELAY_MS);
    });

    return { connection, channel };

  } catch (error) {
    logger.error(`RabbitMQ subscriber connection attempt ${retryCount + 1} failed`, { error: error.message });
    
    if (retryCount < MAX_RETRY_ATTEMPTS - 1) {
      logger.info(`Retrying in ${RETRY_DELAY_MS}ms...`);
      await sleep(RETRY_DELAY_MS);
      return connect(retryCount + 1);
    } else {
      logger.error('Max retry attempts reached. Could not connect to RabbitMQ subscriber');
      throw error;
    }
  }
};

const handleBookDeleted = async (message) => {
  try {
    const { bookId, title } = message;
    
    deletedBooks.add(bookId);
    logger.warn('Book deleted - added to deleted books set', { 
      bookId, 
      title,
      deletedBooksCount: deletedBooks.size 
    });
  } catch (error) {
    logger.error('Error handling book.deleted event', { 
      error: error.message,
      message 
    });
    throw error;
  }
};

const startSubscribing = async () => {
  try {
    if (!channel) {
      await connect();
    }

    channel.consume(QUEUE_NAME, async (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          const routingKey = msg.fields.routingKey;

          logger.info('Received event', { routingKey, content });

          switch (routingKey) {
            case 'book.deleted':
              await handleBookDeleted(content);
              break;
            default:
              logger.warn('Unknown event type', { routingKey });
          }

          channel.ack(msg);

        } catch (error) {
          logger.error('Error processing message', { 
            error: error.message,
            routingKey: msg.fields.routingKey 
          });
          
          channel.nack(msg, false, true);
        }
      }
    }, {
      noAck: false
    });

    logger.info('Started consuming messages from queue', { queue: QUEUE_NAME });

  } catch (error) {
    logger.error('Failed to start subscribing', { error: error.message });
    throw error;
  }
};

const closeConnection = async () => {
  try {
    if (channel) {
      await channel.close();
    }
    if (connection) {
      await connection.close();
    }
    logger.info('RabbitMQ subscriber connection closed gracefully');
  } catch (error) {
    logger.error('Error closing RabbitMQ subscriber connection', { error: error.message });
  }
};

const isBookDeleted = (bookId) => {
  return deletedBooks.has(bookId) || deletedBooks.has(bookId.toString());
};

const clearDeletedBooks = () => {
  deletedBooks.clear();
  logger.info('Deleted books set cleared');
};

module.exports = {
  startSubscribing,
  closeConnection,
  isBookDeleted,
  clearDeletedBooks,
  getDeletedBooksCount: () => deletedBooks.size
};
