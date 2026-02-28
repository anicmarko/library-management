const express = require('express');
const amqp = require('amqplib');

const app = express();
const PORT = process.env.PORT || 3004;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

app.use(express.json());

let rabbitConnection;
let channel;

app.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    service: 'notification-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    rabbitmq: rabbitConnection ? 'connected' : 'disconnected',
  };
  
  res.status(200).json(health);
});

app.get('/', (req, res) => {
  res.json({
    service: 'Notification Service',
    version: '1.0.0',
    description: 'Manages email, SMS, and push notifications',
    endpoints: {
      '/': 'Service information',
      '/health': 'Health check',
      '/api/notifications': 'Notification management (placeholder)',
    },
  });
});

app.get('/api/notifications', (req, res) => {
  res.json({
    message: 'Notifications endpoint - implementation pending',
    notifications: [],
  });
});

async function connectRabbitMQ() {
  try {
    rabbitConnection = await amqp.connect(RABBITMQ_URL);
    console.log('[INFO] Connected to RabbitMQ');
    
    channel = await rabbitConnection.createChannel();
    console.log('[INFO] RabbitMQ channel created');
    
    const queue = 'notifications';
    await channel.assertQueue(queue, { durable: true });
    console.log(`[INFO] Waiting for messages in queue: ${queue}`);
    
    channel.consume(queue, (msg) => {
      if (msg) {
        const content = msg.content.toString();
        console.log(`[INFO] Received notification: ${content}`);
        channel.ack(msg);
      }
    });
    
    rabbitConnection.on('error', (err) => {
      console.error('[ERROR] RabbitMQ connection error:', err.message);
    });
    
    rabbitConnection.on('close', () => {
      console.log('[WARN] RabbitMQ connection closed');
    });
  } catch (error) {
    console.error('[ERROR] RabbitMQ connection error:', error.message);
  }
}

async function startServer() {
  await connectRabbitMQ();
  
  app.listen(PORT, () => {
    console.log(`[INFO] Notification Service running on port ${PORT}`);
    console.log(`[INFO] Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

process.on('SIGTERM', async () => {
  console.log('[WARN] SIGTERM received, shutting down gracefully...');
  if (channel) await channel.close();
  if (rabbitConnection) await rabbitConnection.close();
  process.exit(0);
});

startServer();
