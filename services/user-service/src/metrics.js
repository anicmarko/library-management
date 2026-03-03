'use strict';

const client = require('prom-client');

const register = new client.Registry();

// Default metrics: CPU, memory, event loop lag, GC, etc.
client.collectDefaultMetrics({ register, prefix: 'user_service_' });

// HTTP request duration histogram
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.005, 0.015, 0.05, 0.1, 0.2, 0.3, 0.5, 1],
  registers: [register],
});

// Total HTTP requests counter
const httpRequestTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// HTTP errors counter
const httpErrorTotal = new client.Counter({
  name: 'http_errors_total',
  help: 'Total number of HTTP errors (status >= 400)',
  labelNames: ['method', 'route'],
  registers: [register],
});

/**
 * Express middleware — records duration, total and error counts per request.
 */
const metricsMiddleware = (req, res, next) => {
  const end = httpRequestDuration.startTimer();

  res.on('finish', () => {
    const route = req.route ? req.route.path : req.path;
    const labels = { method: req.method, route, status_code: res.statusCode };

    end(labels);
    httpRequestTotal.inc(labels);

    if (res.statusCode >= 400) {
      httpErrorTotal.inc({ method: req.method, route });
    }
  });

  next();
};

module.exports = { register, metricsMiddleware };
