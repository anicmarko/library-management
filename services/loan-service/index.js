const express = require('express');
const { Pool } = require('pg');
const amqp = require('amqplib');

const app = express();
const PORT = process.env.PORT || 3002;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/loansdb';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

app.use(express.json());

const pool = new Pool({ connectionString: DATABASE_URL });
let rabbitConnection;

app.get('/health', async (req, res) => {
  let dbStatus = 'disconnected';
  
  try {
    await pool.query('SELECT 1');
    dbStatus = 'connected';
  } catch (error) {
    console.error('Database health check failed:', error.message);
  }
  
  const health = {
    status: 'healthy',
    service: 'loan-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    postgres: dbStatus,
    rabbitmq: rabbitConnection ? 'connected' : 'disconnected',
  };
  
  res.status(200).json(health);
});

app.get('/', (req, res) => {
  res.json({
    service: 'Loan Service',
    version: '1.0.0',
    description: 'Manages book loans and returns',
    endpoints: {
      '/': 'Service information',
      '/health': 'Health check',
      '/api/loans': 'Loan management (placeholder)',
    },
  });
});

app.get('/api/loans', (req, res) => {
  res.json({
    message: 'Loans endpoint - implementation pending',
    loans: [],
  });
});

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

async function testDatabase() {
  try {
    await pool.query('SELECT NOW()');
    console.log('[INFO] Connected to PostgreSQL');
  } catch (error) {
    console.error('[ERROR] PostgreSQL connection error:', error.message);
  }
}

async function startServer() {
  await testDatabase();
  await connectRabbitMQ();
  
  app.listen(PORT, () => {
    console.log(`[INFO] Loan Service running on port ${PORT}`);
    console.log(`[INFO] Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

process.on('SIGTERM', async () => {
  console.log('[WARN] SIGTERM received, shutting down gracefully...');
  await pool.end();
  if (rabbitConnection) await rabbitConnection.close();
  process.exit(0);
});

startServer();
