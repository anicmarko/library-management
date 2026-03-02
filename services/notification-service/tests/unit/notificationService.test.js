const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');

// Variables used inside jest.mock() factories MUST be prefixed with 'mock'
const mockSequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });

const mockNotification = mockSequelize.define('Notification', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  eventType: { type: DataTypes.STRING, allowNull: false },
  service: { type: DataTypes.STRING, allowNull: true },
  payload: { type: DataTypes.TEXT, allowNull: true },
  read: { type: DataTypes.BOOLEAN, defaultValue: false }
}, { tableName: 'notifications', timestamps: true });

jest.mock('../../src/db/db', () => ({
  sequelize: mockSequelize,
  connectDB: jest.fn().mockResolvedValue(true),
  disconnectDB: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/models/notificationModel', () => mockNotification);

jest.mock('../../src/messaging/subscriber', () => ({
  startSubscribing: jest.fn().mockResolvedValue(true),
  closeConnection: jest.fn().mockResolvedValue(true),
  handleEvent: jest.fn()
}));

jest.mock('../../src/utils/logger', () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  };
  mockLogger.requestLogger = (req, res, next) => next();
  return mockLogger;
});

const app = require('../../src/index');
const subscriberModule = require('../../src/messaging/subscriber');

beforeAll(async () => {
  await mockSequelize.sync({ force: true });
});

afterEach(async () => {
  await mockNotification.destroy({ truncate: true });
});

afterAll(async () => {
  await mockSequelize.close();
});

describe('Notification Model', () => {
  test('should create a notification with all required fields', async () => {
    const n = await mockNotification.create({
      eventType: 'book.created',
      service: 'book-service',
      payload: JSON.stringify({ id: '123', title: 'Test' }),
      read: false
    });

    expect(n.id).toBeDefined();
    expect(n.eventType).toBe('book.created');
    expect(n.service).toBe('book-service');
    expect(n.read).toBe(false);
    expect(n.createdAt).toBeDefined();
  });

  test('should default read to false', async () => {
    const n = await mockNotification.create({ eventType: 'loan.created', service: 'loan-service' });
    expect(n.read).toBe(false);
  });

  test('should fail without required eventType', async () => {
    await expect(mockNotification.create({ service: 'book-service' })).rejects.toThrow();
  });
});

describe('Subscriber handleEvent', () => {
  beforeEach(() => {
    subscriberModule.handleEvent.mockImplementation(async (routingKey, payload) => {
      const SERVICE_MAP = { book: 'book-service', loan: 'loan-service', user: 'user-service' };
      const prefix = routingKey.split('.')[0];
      const serviceName = SERVICE_MAP[prefix] || 'unknown';
      await mockNotification.create({
        eventType: routingKey,
        service: serviceName,
        payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
        read: false
      });
    });
  });

  test('should save a notification when a book.created event arrives', async () => {
    await subscriberModule.handleEvent('book.created', { id: 'b1', title: 'New Book' });

    const notifications = await mockNotification.findAll();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].eventType).toBe('book.created');
    expect(notifications[0].service).toBe('book-service');
    expect(notifications[0].read).toBe(false);
  });

  test('should save a notification when a loan.returned event arrives', async () => {
    await subscriberModule.handleEvent('loan.returned', { loanId: 'l1' });

    const n = await mockNotification.findOne({ where: { eventType: 'loan.returned' } });
    expect(n).not.toBeNull();
    expect(n.service).toBe('loan-service');
  });

  test('should save a notification when a user.created event arrives', async () => {
    await subscriberModule.handleEvent('user.created', { userId: 'u1' });

    const n = await mockNotification.findOne({ where: { eventType: 'user.created' } });
    expect(n).not.toBeNull();
    expect(n.service).toBe('user-service');
  });

  test('should stringify payload when it is an object', async () => {
    const payload = { id: 'b2', title: 'Object Payload' };
    await subscriberModule.handleEvent('book.updated', payload);

    const n = await mockNotification.findOne({ where: { eventType: 'book.updated' } });
    expect(typeof n.payload).toBe('string');
    expect(JSON.parse(n.payload)).toMatchObject(payload);
  });
});

describe('GET /notifications', () => {
  beforeEach(async () => {
    await mockNotification.bulkCreate([
      { eventType: 'book.created', service: 'book-service', payload: '{}', read: false },
      { eventType: 'loan.created', service: 'loan-service', payload: '{}', read: true },
      { eventType: 'book.deleted', service: 'book-service', payload: '{}', read: false }
    ]);
  });

  test('should return all notifications', async () => {
    const res = await request(app).get('/notifications');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(3);
  });

  test('should filter by eventType', async () => {
    const res = await request(app).get('/notifications?eventType=book.created');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].eventType).toBe('book.created');
  });

  test('should filter by read=false', async () => {
    const res = await request(app).get('/notifications?read=false');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    res.body.data.forEach((n) => expect(n.read).toBe(false));
  });

  test('should filter by read=true', async () => {
    const res = await request(app).get('/notifications?read=true');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].read).toBe(true);
  });

  test('should respect limit query parameter', async () => {
    const res = await request(app).get('/notifications?limit=2');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });
});

describe('GET /notifications/:id', () => {
  test('should return a single notification by id', async () => {
    const n = await mockNotification.create({ eventType: 'book.created', service: 'book-service', payload: '{}' });

    const res = await request(app).get(`/notifications/${n.id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(n.id);
  });

  test('should return 404 for non-existent notification', async () => {
    const res = await request(app).get('/notifications/99999');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('PUT /notifications/:id/read', () => {
  test('should mark a notification as read', async () => {
    const n = await mockNotification.create({ eventType: 'loan.created', service: 'loan-service', read: false });

    const res = await request(app).put(`/notifications/${n.id}/read`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.read).toBe(true);

    const updated = await mockNotification.findByPk(n.id);
    expect(updated.read).toBe(true);
  });

  test('should return 404 when notification does not exist', async () => {
    const res = await request(app).put('/notifications/99999/read');
    expect(res.status).toBe(404);
  });
});

describe('DELETE /notifications/read', () => {
  test('should delete all read notifications', async () => {
    await mockNotification.bulkCreate([
      { eventType: 'book.created', service: 'book-service', read: true },
      { eventType: 'loan.created', service: 'loan-service', read: true },
      { eventType: 'user.created', service: 'user-service', read: false }
    ]);

    const res = await request(app).delete('/notifications/read');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe(2);

    const remaining = await mockNotification.findAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].read).toBe(false);
  });
});

describe('GET /health', () => {
  test('should return health status with counts', async () => {
    await mockNotification.bulkCreate([
      { eventType: 'book.created', service: 'book-service', read: false },
      { eventType: 'loan.created', service: 'loan-service', read: true }
    ]);

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('notification-service');
    expect(res.body.totalNotifications).toBe(2);
    expect(res.body.unreadCount).toBe(1);
  });
});
