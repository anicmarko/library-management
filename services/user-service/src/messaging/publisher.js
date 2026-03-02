const amqp = require('amqplib');
const logger = require('../utils/logger');

const EXCHANGE_NAME = 'library.events';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

let connection = null;
let channel = null;

/**
 * Connect to RabbitMQ and set up exchange
 */
async function connect() {
  try {
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();

    await channel.assertExchange(EXCHANGE_NAME, 'topic', {
      durable: true,
    });

    logger.info('RabbitMQ publisher connected', { exchange: EXCHANGE_NAME });

    connection.on('error', (err) => {
      logger.error('RabbitMQ connection error', { error: err.message });
    });

    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed, reconnecting...');
      setTimeout(connect, 5000);
    });
  } catch (error) {
    logger.error('Failed to connect to RabbitMQ', { error: error.message });
    setTimeout(connect, 5000);
  }
}

/**
 * Publish user.created event
 * @param {Object} user - User object
 */
async function publishUserCreated(user) {
  if (!channel) {
    logger.error('Cannot publish: RabbitMQ channel not initialized');
    return;
  }

  const event = {
    userId: user.id,
    name: user.name,
    email: user.email,
    timestamp: new Date().toISOString(),
  };

  const routingKey = 'user.created';

  try {
    channel.publish(
      EXCHANGE_NAME,
      routingKey,
      Buffer.from(JSON.stringify(event)),
      { persistent: true }
    );

    logger.info('Published user.created event', { userId: user.id, routingKey });
  } catch (error) {
    logger.error('Failed to publish user.created event', {
      error: error.message,
      userId: user.id,
    });
  }
}

/**
 * Publish user.updated event
 * @param {Object} user - User object
 * @param {Object} changes - Changes made to user
 */
async function publishUserUpdated(user, changes) {
  if (!channel) {
    logger.error('Cannot publish: RabbitMQ channel not initialized');
    return;
  }

  const event = {
    userId: user.id,
    changes,
    timestamp: new Date().toISOString(),
  };

  const routingKey = 'user.updated';

  try {
    channel.publish(
      EXCHANGE_NAME,
      routingKey,
      Buffer.from(JSON.stringify(event)),
      { persistent: true }
    );

    logger.info('Published user.updated event', { userId: user.id, routingKey });
  } catch (error) {
    logger.error('Failed to publish user.updated event', {
      error: error.message,
      userId: user.id,
    });
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
    logger.info('RabbitMQ publisher connection closed');
  } catch (error) {
    logger.error('Error closing RabbitMQ connection', { error: error.message });
  }
}

module.exports = {
  connect,
  publishUserCreated,
  publishUserUpdated,
  closeConnection,
};
