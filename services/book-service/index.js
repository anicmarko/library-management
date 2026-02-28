const express = require('express');
const { MongoClient } = require('mongodb');
const amqp = require('amqplib');

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/books';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

app.use(express.json());

let mongoClient;
let rabbitConnection;

app.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    service: 'book-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb: mongoClient ? 'connected' : 'disconnected',
    rabbitmq: rabbitConnection ? 'connected' : 'disconnected',
  };
  
  res.status(200).json(health);
});

app.get('/', (req, res) => {
  res.json({
    service: 'Book Service',
    version: '1.0.0',
    description: 'Manages book inventory and catalog',
    endpoints: {
      '/': 'Service information',
      '/health': 'Health check',
      '/api/books': 'Book management (placeholder)',
    },
  });
});

app.get('/api/books', (req, res) => {
  res.json({
    message: 'Books endpoint - implementation pending',
    books: [],
  });
});

async function connectMongoDB() {
  try {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    console.log('[INFO] Connected to MongoDB');
  } catch (error) {
    console.error('[ERROR] MongoDB connection error:', error.message);
  }
}

async function connectRabbitMQ() {
  try {
    rabbitConnection = await amqp.connect(RABBITMQ_URL);
    console.log('[INFO] Connected to RabbitMQ');
    
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
  await connectMongoDB();
  await connectRabbitMQ();
  
  app.listen(PORT, () => {
    console.log(`[INFO] Book Service running on port ${PORT}`);
    console.log(`[INFO] Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

process.on('SIGTERM', async () => {
  console.log('[WARN] SIGTERM received, shutting down gracefully...');
  if (mongoClient) await mongoClient.close();
  if (rabbitConnection) await rabbitConnection.close();
  process.exit(0);
});

startServer();
