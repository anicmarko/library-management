'use strict';

const { createEventStream, createReactiveSubscriber } = require('@library/shared');
const logger = require('../utils/logger');
const Notification = require('../models/notificationModel');
const { notificationSubject } = require('./notificationSubject');

const QUEUE_NAME = 'notification-service-reactive-queue';

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

const { startReactiveSubscribing } = createReactiveSubscriber({
  queueName: QUEUE_NAME,
  routingKeys: ROUTING_KEYS,
  handleEvent,
  logger,
});

module.exports = {
  createEventStream: (channel, queue) => createEventStream(channel, queue, logger),
  handleEvent,
  startReactiveSubscribing,
};
