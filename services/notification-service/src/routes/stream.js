'use strict';

const { Router } = require('express');
const { notificationSubject } = require('../messaging/notificationSubject');
const logger = require('../utils/logger');

const router = Router();

router.get('/notifications/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  logger.info('SSE client connected', { ip: req.ip });

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30_000);

  const subscription = notificationSubject.subscribe({
    next: (notification) => {
      res.write(`data: ${JSON.stringify(notification)}\n\n`);
    },
    error: (err) => {
      logger.error('SSE stream error', { error: err.message });
      res.end();
    },
  });

  req.on('close', () => {
    logger.info('SSE client disconnected', { ip: req.ip });
    clearInterval(heartbeat);
    subscription.unsubscribe();
  });
});

module.exports = router;
