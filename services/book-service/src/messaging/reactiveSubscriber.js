'use strict';

const { createEventStream, createReactiveSubscriber } = require('@library/shared');
const logger = require('../utils/logger');
const Book = require('../models/bookModel');

const QUEUE_NAME = 'book-service-reactive-queue';

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

const { startReactiveSubscribing } = createReactiveSubscriber({
  queueName: QUEUE_NAME,
  routingKeys: ['loan.created', 'loan.returned'],
  handleEvent,
  logger,
});

module.exports = {
  createEventStream: (channel, queue) => createEventStream(channel, queue, logger),
  handleEvent,
  startReactiveSubscribing,
};
