'use strict';

const amqp = require('amqplib');
const { map } = require('rxjs/operators');
const { createEventStream } = require('./createEventStream');

/**
 * Factory that creates a self-reconnecting RabbitMQ reactive subscriber.
 * All connection/retry boilerplate lives here; services only supply
 * queue name, routing keys, and their own handleEvent callback.
 *
 * @param {object}   opts
 * @param {string}   opts.queueName      - RabbitMQ queue name
 * @param {string[]} opts.routingKeys    - Routing keys to bind
 * @param {Function} opts.handleEvent    - async ({ routingKey, payload, receivedAt }) => void
 * @param {object}   opts.logger         - logger with .info/.warn/.error methods
 * @param {string}   [opts.exchangeName] - defaults to 'library.events'
 * @param {number}   [opts.retryDelayMs] - reconnect delay in ms, defaults to 3000
 * @returns {{ startReactiveSubscribing: Function }}
 */
function createReactiveSubscriber({
  queueName,
  routingKeys,
  handleEvent,
  logger,
  exchangeName = 'library.events',
  retryDelayMs = 3000,
}) {
  const startReactiveSubscribing = async () => {
    try {
      const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
      const connection = await amqp.connect(rabbitmqUrl);
      const channel = await connection.createChannel();

      await channel.assertExchange(exchangeName, 'topic', { durable: true });
      await channel.assertQueue(queueName, { durable: true });

      for (const key of routingKeys) {
        await channel.bindQueue(queueName, exchangeName, key);
      }

      logger.info('[reactive] RabbitMQ reactive subscriber connected', {
        exchange: exchangeName,
        queue: queueName,
      });

      const stream$ = createEventStream(channel, queueName, logger).pipe(
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
        complete: () => logger.info('[reactive] Event stream completed'),
      });

      connection.on('close', () => {
        logger.warn('[reactive] Connection closed, restarting');
        subscription.unsubscribe();
        setTimeout(startReactiveSubscribing, retryDelayMs);
      });

      return subscription;
    } catch (error) {
      logger.error('[reactive] Failed to start reactive subscriber', { error: error.message });
      setTimeout(startReactiveSubscribing, retryDelayMs);
    }
  };

  return { startReactiveSubscribing };
}

module.exports = { createReactiveSubscriber };
