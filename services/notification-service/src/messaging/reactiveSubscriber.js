'use strict';

const amqp = require('amqplib');
const { map } = require('rxjs/operators');
const { createEventStream } = require('@library/shared');
const logger = require('../utils/logger');
const Notification = require('../models/notificationModel');
const { notificationSubject } = require('./notificationSubject');

const EXCHANGE_NAME = 'library.events';
const EXCHANGE_TYPE = 'topic';
const QUEUE_NAME = 'notification-service-reactive-queue';
const RETRY_DELAY_MS = 3000;

const ROUTING_KEYS = [
  'book.created', 'book.updated', 'book.deleted',
  'loan.created', 'loan.returned',
  'user.created', 'user.updated',
];

const SERVICE_MAP = { book: 'book-service', loan: 'loan-service', user: 'user-service' };

const handleEvent = async ({ routingKey, payload }) => {
  const prefix = routingKey.split('.')[0];
  const service = SERVICE_MAP[prefix] || 'unknown';

  const notification = await Notification.create({
    eventType: routingKey,
    service,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    read: false,
  });

  logger.info('[reactive] Notification saved', { eventType: routingKey, service });

  // Push to the hot Subject — SSE clients receive it immediately
  notificationSubject.next(notification.toJSON());
};


const startReactiveSubscribing = async () => {
  try {
    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
    const connection = await amqp.connect(rabbitmqUrl);
    const channel = await connection.createChannel();

    await channel.assertExchange(EXCHANGE_NAME, EXCHANGE_TYPE, { durable: true });
    await channel.assertQueue(QUEUE_NAME, { durable: true });

    for (const key of ROUTING_KEYS) {
      await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, key);
    }

    logger.info('[reactive] RabbitMQ reactive subscriber connected', {
      exchange: EXCHANGE_NAME,
      queue: QUEUE_NAME,
    });

    const stream$ = createEventStream(channel, QUEUE_NAME, logger).pipe(
      map(event => ({ ...event, receivedAt: new Date().toISOString() }))
    );

    const subscription = stream$.subscribe({
      next: async (event) => {
        try {
          await handleEvent(event);
        } catch (err) {
          logger.error('[reactive] Handler error', { error: err.message });
        }
      },
      error: (err) => logger.error('[reactive] Unhandled stream error', { error: err.message }),
      complete: () => logger.info('[reactive] Stream completed'),
    });

    connection.on('close', () => {
      logger.warn('[reactive] Connection closed, restarting');
      subscription.unsubscribe();
      setTimeout(startReactiveSubscribing, RETRY_DELAY_MS);
    });

    return subscription;
  } catch (error) {
    logger.error('[reactive] Failed to start', { error: error.message });
    setTimeout(startReactiveSubscribing, RETRY_DELAY_MS);
  }
};

module.exports = {
  createEventStream: (channel, queue) => createEventStream(channel, queue, logger),
  handleEvent,
  startReactiveSubscribing,
};
