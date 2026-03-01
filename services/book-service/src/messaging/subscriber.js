const amqp = require('amqplib');
const logger = require('../utils/logger');
const Book = require('../models/bookModel');

const EXCHANGE_NAME = 'library.events';
const EXCHANGE_TYPE = 'topic';
const QUEUE_NAME = 'book-service-queue';
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

    await channel.assertQueue(QUEUE_NAME, {
      durable: true
    });

    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'loan.created');
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'loan.returned');

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

const handleLoanCreated = async (message) => {
  try {
    const { bookId, loanId } = message;
    
    const book = await Book.findById(bookId);
    if (book) {
      book.available = false;
      await book.save();
      logger.info('Book marked as unavailable', { bookId, loanId });
    } else {
      logger.warn('Book not found for loan.created event', { bookId, loanId });
    }
  } catch (error) {
    logger.error('Error handling loan.created event', { 
      error: error.message,
      message 
    });
    throw error;
  }
};

const handleLoanReturned = async (message) => {
  try {
    const { bookId, loanId } = message;
    
    const book = await Book.findById(bookId);
    if (book) {
      book.available = true;
      await book.save();
      logger.info('Book marked as available', { bookId, loanId });
    } else {
      logger.warn('Book not found for loan.returned event', { bookId, loanId });
    }
  } catch (error) {
    logger.error('Error handling loan.returned event', { 
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
            case 'loan.created':
              await handleLoanCreated(content);
              break;
            case 'loan.returned':
              await handleLoanReturned(content);
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

module.exports = {
  startSubscribing,
  closeConnection
};
