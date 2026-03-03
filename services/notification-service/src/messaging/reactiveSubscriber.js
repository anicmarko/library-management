'use strict';

const amqp = require('amqplib');
const { Observable, EMPTY } = require('rxjs');
const { catchError, retry, filter, map } = require('rxjs/operators');
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

function createEventStream(channel, queue) {
  return new Observable(subscriber => {
    channel.consume(queue, (msg) => {
      if (!msg) return;
      try {
        const payload = JSON.parse(msg.content.toString());
        const routingKey = msg.fields.routingKey;
        channel.ack(msg);
        subscriber.next({ routingKey, payload });
      } catch (err) {
        subscriber.error(err);
      }
    });

    // Teardown: cancel consumer when unsubscribed
    return () => {
      channel.cancel(queue).catch(() => {});
    };
  }).pipe(
    retry(3),
    catchError(err => {
      logger.error('[reactive] Event stream error', { error: err.message });
      return EMPTY;
    }),
    filter(event => event !== null)
  );
}


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

    const stream$ = createEventStream(channel, QUEUE_NAME).pipe(
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

module.exports = { createEventStream, handleEvent, startReactiveSubscribing };
