const express = require('express');
const mysql = require('mysql2/promise');
const amqp = require('amqplib');

const app = express();
const PORT = process.env.PORT || 3003;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

app.use(express.json());

let mysqlConnection;
let rabbitConnection;

const mysqlConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: process.env.MYSQL_PORT || 3306,
  user: process.env.MYSQL_USER || 'library',
  password: process.env.MYSQL_PASSWORD || 'library',
  database: process.env.MYSQL_DATABASE || 'usersdb',
};

app.get('/health', async (req, res) => {
  let dbStatus = 'disconnected';
  
  try {
    if (mysqlConnection) {
      await mysqlConnection.ping();
      dbStatus = 'connected';
    }
  } catch (error) {
    console.error('Database health check failed:', error.message);
  }
  
  const health = {
    status: 'healthy',
    service: 'user-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mysql: dbStatus,
    rabbitmq: rabbitConnection ? 'connected' : 'disconnected',
  };
  
  res.status(200).json(health);
});

app.get('/', (req, res) => {
  res.json({
    service: 'User Service',
    version: '1.0.0',
    description: 'Manages user authentication and profiles',
    endpoints: {
      '/': 'Service information',
      '/health': 'Health check',
      '/api/users': 'User management (placeholder)',
    },
  });
});

app.get('/api/users', (req, res) => {
  res.json({
    message: 'Users endpoint - implementation pending',
    users: [],
  });
});

async function connectMySQL() {
  try {
    mysqlConnection = await mysql.createConnection(mysqlConfig);
    console.log('[INFO] Connected to MySQL');
  } catch (error) {
    console.error('[ERROR] MySQL connection error:', error.message);
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
  await connectMySQL();
  await connectRabbitMQ();
  
  app.listen(PORT, () => {
    console.log(`[INFO] User Service running on port ${PORT}`);
    console.log(`[INFO] Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

process.on('SIGTERM', async () => {
  console.log('[WARN] SIGTERM received, shutting down gracefully...');
  if (mysqlConnection) await mysqlConnection.end();
  if (rabbitConnection) await rabbitConnection.close();
  process.exit(0);
});

startServer();
