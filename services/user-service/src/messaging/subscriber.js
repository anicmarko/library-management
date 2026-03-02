const amqp = require('amqplib');
const logger = require('../utils/logger');
const { getUserModel } = require('../db/db');

const EXCHANGE_NAME = 'library.events';
const QUEUE_NAME = 'user-service-queue';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

let connection = null;
let channel = null;

/**
 * Handle loan.created event - increment user's loanCount
 * @param {Object} event - Event data
 */
async function handleLoanCreated(event) {
  try {
    const User = getUserModel();
    const { userId, loanId } = event;

    logger.info('Processing loan.created event', { userId, loanId });

    const user = await User.findByPk(userId);

    if (!user) {
      logger.warn('User not found for loan.created event', { userId, loanId });
      return;
    }

    // Increment loan count
    user.loanCount += 1;
    await user.save();

    logger.info('User loanCount incremented', {
      userId: user.id,
      loanCount: user.loanCount,
      loanId,
    });
  } catch (error) {
    logger.error('Error handling loan.created event', {
      error: error.message,
      event,
    });
  }
}

/**
 * Handle loan.returned event - no action needed
 * @param {Object} event - Event data
 */
async function handleLoanReturned(event) {
  try {
    const { userId, loanId } = event;
    logger.info('Received loan.returned event', { userId, loanId });
    // No action needed for now - loanCount tracks total loans, not active loans
  } catch (error) {
    logger.error('Error handling loan.returned event', {
      error: error.message,
      event,
    });
  }
}

/**
 * Process incoming messages
 * @param {Object} msg - RabbitMQ message
 */
async function processMessage(msg) {
  if (!msg) return;

  try {
    const event = JSON.parse(msg.content.toString());
    const routingKey = msg.fields.routingKey;

    logger.debug('Received event', { routingKey, event });

    switch (routingKey) {
      case 'loan.created':
        await handleLoanCreated(event);
        break;
      case 'loan.returned':
        await handleLoanReturned(event);
        break;
      default:
        logger.debug('Ignoring unhandled event', { routingKey });
    }

    channel.ack(msg);
  } catch (error) {
    logger.error('Error processing message', { error: error.message });
    channel.nack(msg, false, false);
  }
}

/**
 * Start subscribing to events
 */
async function startSubscribing() {
  try {
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();

    await channel.assertExchange(EXCHANGE_NAME, 'topic', {
      durable: true,
    });

    await channel.assertQueue(QUEUE_NAME, {
      durable: true,
    });

    // Bind queue to routing keys
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'loan.created');
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'loan.returned');

    // Set prefetch to process one message at a time
    await channel.prefetch(1);

    logger.info('RabbitMQ subscriber started', {
      queue: QUEUE_NAME,
      patterns: ['loan.created', 'loan.returned'],
    });

    // Start consuming messages
    channel.consume(QUEUE_NAME, processMessage, { noAck: false });

    connection.on('error', (err) => {
      logger.error('RabbitMQ connection error', { error: err.message });
    });

    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed, reconnecting...');
      setTimeout(startSubscribing, 5000);
    });
  } catch (error) {
    logger.error('Failed to start RabbitMQ subscriber', {
      error: error.message,
    });
    setTimeout(startSubscribing, 5000);
  }
}

/**
 * Close RabbitMQ connection
 */
async function closeConnection() {
  try {
    if (channel) {
      await channel.close();
    }
    if (connection) {
      await connection.close();
    }
    logger.info('RabbitMQ subscriber connection closed');
  } catch (error) {
    logger.error('Error closing RabbitMQ connection', { error: error.message });
  }
}

module.exports = {
  startSubscribing,
  closeConnection,
};
