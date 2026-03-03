'use strict';

const { Observable, EMPTY } = require('rxjs');
const { catchError, retry, filter } = require('rxjs/operators');

/**
 * Creates a cold Observable over a RabbitMQ consumer channel.
 * Emits `{ routingKey, payload }` for every valid inbound message.
 * On subscription teardown the channel consumer is cancelled.
 *
 * @param {object} channel  - amqplib channel
 * @param {string} queue    - queue name to consume from
 * @param {object} logger   - logger with an `.error()` method
 * @returns {Observable<{routingKey: string, payload: object}>}
 */
function createEventStream(channel, queue, logger) {
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

module.exports = { createEventStream };
