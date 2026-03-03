'use strict';

const amqp = require('amqplib');
const { map } = require('rxjs/operators');
const { createEventStream } = require('@library/shared');
const logger = require('../utils/logger');
const Book = require('../models/bookModel');

const EXCHANGE_NAME = 'library.events';
const EXCHANGE_TYPE = 'topic';
const QUEUE_NAME = 'book-service-reactive-queue';
const RETRY_DELAY_MS = 3000;

const handleEvent = async ({ routingKey, payload }) => {
  const { bookId, loanId } = payload;

  if (routingKey === 'loan.created') {
    const book = await Book.findById(bookId);
    if (book) {
      book.available = false;
      await book.save();
      logger.info('[reactive] Book marked unavailable', { bookId, loanId });
    } else {
      logger.warn('[reactive] Book not found for loan.created', { bookId });
    }
  }

  if (routingKey === 'loan.returned') {
    const book = await Book.findById(bookId);
    if (book) {
      book.available = true;
      await book.save();
      logger.info('[reactive] Book marked available', { bookId, loanId });
    } else {
      logger.warn('[reactive] Book not found for loan.returned', { bookId });
    }
  }
};


const startReactiveSubscribing = async () => {
  try {
    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
    const connection = await amqp.connect(rabbitmqUrl);
    const channel = await connection.createChannel();

    await channel.assertExchange(EXCHANGE_NAME, EXCHANGE_TYPE, { durable: true });
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'loan.created');
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'loan.returned');

    logger.info('[reactive] RabbitMQ reactive subscriber connected', {
      exchange: EXCHANGE_NAME,
      queue: QUEUE_NAME,
    });

    const stream$ = createEventStream(channel, QUEUE_NAME, logger).pipe(
      map(event => ({
        ...event,
        receivedAt: new Date().toISOString(),
      }))
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
      logger.warn('[reactive] Connection closed, unsubscribing');
      subscription.unsubscribe();
      setTimeout(startReactiveSubscribing, RETRY_DELAY_MS);
    });

    return subscription;
  } catch (error) {
    logger.error('[reactive] Failed to start reactive subscriber', { error: error.message });
    setTimeout(startReactiveSubscribing, RETRY_DELAY_MS);
  }
};

module.exports = {
  createEventStream: (channel, queue) => createEventStream(channel, queue, logger),
  handleEvent,
  startReactiveSubscribing,
};
