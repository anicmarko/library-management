'use strict';

const axios = require('axios');
const { sleep, waitForServices, BASE_URL } = require('./helpers');

jest.setTimeout(60000);

let createdUserId = null;
let createdBookId = null;
let createdLoanId = null;

const api = axios.create({
  baseURL: BASE_URL,
  validateStatus: () => true, // always resolve, inspect status manually
  timeout: 10000,
});

const RUN_ID = Date.now();

beforeAll(async () => {
  await waitForServices(30, 2000);
});

describe('1. Health Checks', () => {
  const services = [
    { name: 'book-service',         path: '/api/books/health' },
    { name: 'loan-service',         path: '/api/loans/health' },
    { name: 'user-service',         path: '/api/users/health' },
    { name: 'notification-service', path: '/api/notifications/health' },
  ];

  test.each(services)('GET $path returns 200 with status ok ($name)', async ({ path }) => {
    const res = await api.get(path);

    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ status: 'ok' });
  });
});

describe('2. Complete User Journey', () => {
  test('2.1 Create user → 201 with userId', async () => {
    const res = await api.post('/api/users', {
      name: `E2E User ${RUN_ID}`,
      email: `e2e.${RUN_ID}@library.test`,
    });

    expect(res.status).toBe(201);
    expect(res.data.success).toBe(true);
    expect(res.data.data).toHaveProperty('id');
    expect(res.data.data.name).toBe(`E2E User ${RUN_ID}`);
    expect(res.data.data.loanCount).toBe(0);

    createdUserId = res.data.data.id;
  });

  test('2.2 Create book → 201 with bookId', async () => {
    const res = await api.post('/api/books', {
      title: `E2E Book ${RUN_ID}`,
      author: 'E2E Author',
      isbn: `E2E-${RUN_ID}`,
    });

    expect(res.status).toBe(201);
    expect(res.data.success).toBe(true);
    expect(res.data.data).toHaveProperty('_id');
    expect(res.data.data.available).toBe(true);

    createdBookId = res.data.data._id;
  });

  test('2.3 Create loan → 201 with loanId', async () => {
    expect(createdUserId).not.toBeNull();
    expect(createdBookId).not.toBeNull();

    const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const res = await api.post('/api/loans', {
      bookId: createdBookId,
      userId: createdUserId,
      dueDate,
    });

    expect(res.status).toBe(201);
    expect(res.data.success).toBe(true);
    expect(res.data.data).toHaveProperty('id');
    expect(res.data.data.status).toBe('active');

    createdLoanId = res.data.data.id;
  });

  test('2.4 After loan creation (wait 1000ms) — user loanCount incremented', async () => {
    expect(createdUserId).not.toBeNull();

    await sleep(1000);

    const res = await api.get(`/api/users/${createdUserId}`);

    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.loanCount).toBeGreaterThanOrEqual(1);
  });

  test('2.5 After loan creation — book available = false', async () => {
    expect(createdBookId).not.toBeNull();

    // Give the book-service RabbitMQ subscriber time to process loan.created
    await sleep(1000);

    const res = await api.get(`/api/books/${createdBookId}`);

    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.available).toBe(false);
  });

  test('2.6 Return book → 200 with status = returned', async () => {
    expect(createdLoanId).not.toBeNull();

    const res = await api.put(`/api/loans/${createdLoanId}/return`);

    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.status).toBe('returned');
  });

  test('2.7 After return (wait 500ms) — book available = true again', async () => {
    expect(createdBookId).not.toBeNull();

    await sleep(500);

    const res = await api.get(`/api/books/${createdBookId}`);

    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.available).toBe(true);
  });
});

describe('3. Event Propagation to Notification Service', () => {
  const assertNotification = async (eventType) => {
    const res = await api.get(`/api/notifications?eventType=${eventType}`);

    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(Array.isArray(res.data.data)).toBe(true);
    expect(res.data.data.length).toBeGreaterThanOrEqual(1);

    const notification = res.data.data[0];
    expect(notification).toHaveProperty('eventType', eventType);
    expect(notification).toHaveProperty('service');
    expect(notification).toHaveProperty('payload');
    expect(notification).toHaveProperty('read');

    return notification;
  };

  test('3.1 user.created notification exists (wait 500ms)', async () => {
    await sleep(500);
    const notification = await assertNotification('user.created');
    expect(notification.service).toBe('user-service');
  });

  test('3.2 book.created notification exists', async () => {
    const notification = await assertNotification('book.created');
    expect(notification.service).toBe('book-service');
  });

  test('3.3 loan.created notification exists', async () => {
    const notification = await assertNotification('loan.created');
    expect(notification.service).toBe('loan-service');
  });

  test('3.4 loan.returned notification exists', async () => {
    const notification = await assertNotification('loan.returned');
    expect(notification.service).toBe('loan-service');
  });

  test('3.5 Notification payload is valid JSON', async () => {
    const res = await api.get('/api/notifications');
    expect(res.status).toBe(200);

    for (const n of res.data.data) {
      if (n.payload) {
        expect(() => JSON.parse(n.payload)).not.toThrow();
      }
    }
  });
});

describe('4. API Gateway Routing', () => {
  const routes = [
    { route: '/api/books',         desc: 'Book Service'         },
    { route: '/api/loans',         desc: 'Loan Service'         },
    { route: '/api/users',         desc: 'User Service'         },
    { route: '/api/notifications', desc: 'Notification Service' },
  ];

  test.each(routes)('GET $route is not a gateway error ($desc)', async ({ route }) => {
    const res = await api.get(route);

    expect(res.status).not.toBe(502);
    expect(res.status).not.toBe(503);
    expect(res.status).not.toBe(504);
  });

  test('GET /api/books returns 200 with success array', async () => {
    const res = await api.get('/api/books');
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(Array.isArray(res.data.data)).toBe(true);
  });

  test('GET /api/users returns 200 with success array', async () => {
    const res = await api.get('/api/users');
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(Array.isArray(res.data.data)).toBe(true);
  });

  test('GET /api/notifications returns 200 with success array', async () => {
    const res = await api.get('/api/notifications');
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(Array.isArray(res.data.data)).toBe(true);
  });

  test('GET unknown route returns 404', async () => {
    const res = await api.get('/api/nonexistent-endpoint-xyz');
    expect(res.status).toBe(404);
  });

  test('GET / returns gateway root info', async () => {
    const res = await api.get('/');
    expect(res.status).toBe(200);
  });

  test('GET /health returns Nginx gateway health', async () => {
    const res = await api.get('/health');
    expect(res.status).toBe(200);
  });
});

describe('5. Data Validation', () => {
  test('5.1 POST /api/users with missing email → 422', async () => {
    const res = await api.post('/api/users', { name: 'No Email User' });

    expect(res.status).toBe(422);
    expect(res.data.success).toBe(false);
    expect(res.data).toHaveProperty('details');
    expect(res.data.details).toHaveProperty('email');
  });

  test('5.2 POST /api/users with missing name → 422', async () => {
    const res = await api.post('/api/users', { email: 'noname@test.com' });

    expect(res.status).toBe(422);
    expect(res.data.success).toBe(false);
    expect(res.data.details).toHaveProperty('name');
  });

  test('5.3 POST /api/books without title → 422', async () => {
    const res = await api.post('/api/books', {
      author: 'Author Only',
      isbn: `isbn-notitle-${RUN_ID}`,
    });

    expect(res.status).toBe(422);
    expect(res.data.success).toBe(false);
    expect(res.data.details).toHaveProperty('title');
  });

  test('5.4 POST /api/books without author → 422', async () => {
    const res = await api.post('/api/books', {
      title: 'Title Only',
      isbn: `isbn-noauthor-${RUN_ID}`,
    });

    expect(res.status).toBe(422);
    expect(res.data.success).toBe(false);
    expect(res.data.details).toHaveProperty('author');
  });

  test('5.5 POST /api/books without isbn → 422', async () => {
    const res = await api.post('/api/books', {
      title: 'Title',
      author: 'Author',
    });

    expect(res.status).toBe(422);
    expect(res.data.success).toBe(false);
    expect(res.data.details).toHaveProperty('isbn');
  });

  test('5.6 POST /api/loans without required fields → 422', async () => {
    const res = await api.post('/api/loans', {});

    expect(res.status).toBe(422);
    expect(res.data.success).toBe(false);
    expect(res.data).toHaveProperty('details');
  });

  test('5.7 GET /api/books/nonexistent-id → 404', async () => {
    const res = await api.get('/api/books/000000000000000000000000');

    expect(res.status).toBe(404);
    expect(res.data.success).toBe(false);
  });

  test('5.8 GET /api/users/nonexistent-id → 404', async () => {
    const res = await api.get('/api/users/999999999');

    expect(res.status).toBe(404);
    expect(res.data.success).toBe(false);
  });

  test('5.9 PUT /api/loans/:id/return on already-returned loan → 409', async () => {
    expect(createdLoanId).not.toBeNull();

    const res = await api.put(`/api/loans/${createdLoanId}/return`);

    expect(res.status).toBe(409);
    expect(res.data.success).toBe(false);
  });
});
