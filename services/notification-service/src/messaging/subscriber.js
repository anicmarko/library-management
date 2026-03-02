const amqp = require('amqplib');
const logger = require('../utils/logger');
const Notification = require('../models/notificationModel');

const EXCHANGE_NAME = 'library.events';
const EXCHANGE_TYPE = 'topic';
const QUEUE_NAME = 'notification-service-queue';
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAY_MS = 3000;

const ROUTING_KEYS = [
  'book.created',
  'book.updated',
  'book.deleted',
  'loan.created',
  'loan.returned',
  'user.created',
  'user.updated'
];

const SERVICE_MAP = {
  book: 'book-service',
  loan: 'loan-service',
  user: 'user-service'
};

let connection = null;
let channel = null;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getServiceName = (routingKey) => {
  const prefix = routingKey.split('.')[0];
  return SERVICE_MAP[prefix] || 'unknown';
};

const handleEvent = async (routingKey, payload) => {
  try {
    const serviceName = getServiceName(routingKey);
    await Notification.create({
      eventType: routingKey,
      service: serviceName,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      read: false
    });
    logger.info('Notification saved', { eventType: routingKey, service: serviceName });
  } catch (error) {
    logger.error('Error saving notification', { error: error.message, eventType: routingKey });
  }
};

const connect = async (retryCount = 0) => {
  try {
    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

    connection = await amqp.connect(rabbitmqUrl);
    channel = await connection.createChannel();

    await channel.assertExchange(EXCHANGE_NAME, EXCHANGE_TYPE, { durable: true });
    await channel.assertQueue(QUEUE_NAME, { durable: true });

    for (const routingKey of ROUTING_KEYS) {
      await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, routingKey);
    }

    logger.info('RabbitMQ subscriber connected successfully', {
      exchange: EXCHANGE_NAME,
      queue: QUEUE_NAME,
      routingKeys: ROUTING_KEYS
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

const startSubscribing = async () => {
  try {
    await connect();

    channel.consume(QUEUE_NAME, async (msg) => {
      if (!msg) return;

      try {
        const routingKey = msg.fields.routingKey;
        const content = JSON.parse(msg.content.toString());

        logger.info('Event received', { routingKey });
        await handleEvent(routingKey, content);

        channel.ack(msg);
      } catch (error) {
        logger.error('Error processing message', { error: error.message });
        channel.nack(msg, false, false);
      }
    });

    logger.info('Listening for events', { routingKeys: ROUTING_KEYS });
  } catch (error) {
    logger.error('Failed to start subscriber', { error: error.message });
  }
};

const closeConnection = async () => {
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
    logger.info('RabbitMQ subscriber connection closed');
  } catch (error) {
    logger.error('Error closing RabbitMQ subscriber connection', { error: error.message });
  }
};

module.exports = { startSubscribing, closeConnection, handleEvent };
