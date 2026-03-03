'use strict';

const { Subject } = require('rxjs');

const mockSubject = new Subject();

jest.mock('../../src/messaging/notificationSubject', () => ({
  notificationSubject: mockSubject,
}));

jest.mock('../../src/models/notificationModel', () => ({
  create: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const { createEventStream, handleEvent } = require('../../src/messaging/reactiveSubscriber');
const Notification = require('../../src/models/notificationModel');

const makeChannel = () => {
  let consumeCallback = null;
  return {
    consume: jest.fn((queue, cb) => { consumeCallback = cb; }),
    ack: jest.fn(),
    cancel: jest.fn().mockResolvedValue(),
    _trigger: (routingKey, payload) => {
      if (consumeCallback) {
        consumeCallback({
          content: Buffer.from(JSON.stringify(payload)),
          fields: { routingKey },
        });
      }
    },
    _triggerNull: () => consumeCallback && consumeCallback(null),
    _triggerBadJson: () => {
      if (consumeCallback) {
        consumeCallback({
          content: Buffer.from('not-valid-json'),
          fields: { routingKey: 'book.created' },
        });
      }
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────

describe('createEventStream (notification-service)', () => {
  afterEach(() => jest.clearAllMocks());

  test('emits parsed { routingKey, payload } on valid message', done => {
    const channel = makeChannel();
    const stream$ = createEventStream(channel, 'test-queue');

    const sub = stream$.subscribe({
      next: event => {
        expect(event.routingKey).toBe('book.created');
        expect(event.payload).toEqual({ id: '42', title: 'Clean Code' });
        expect(channel.ack).toHaveBeenCalledTimes(1);
        sub.unsubscribe();
        done();
      },
    });

    channel._trigger('book.created', { id: '42', title: 'Clean Code' });
  });

  test('ignores null messages', done => {
    const channel = makeChannel();
    const received = [];
    const sub = createEventStream(channel, 'q').subscribe({ next: e => received.push(e) });

    channel._triggerNull();

    setTimeout(() => {
      expect(received).toHaveLength(0);
      sub.unsubscribe();
      done();
    }, 50);
  });

  test('recovers silently from JSON parse error', done => {
    const channel = makeChannel();
    const received = [];
    const errors = [];
    const sub = createEventStream(channel, 'q').subscribe({
      next: e => received.push(e),
      error: e => errors.push(e),
    });

    channel._triggerBadJson();

    setTimeout(() => {
      expect(received).toHaveLength(0);
      expect(errors).toHaveLength(0);
      sub.unsubscribe();
      done();
    }, 50);
  });

  test('emits multiple events in order', done => {
    const channel = makeChannel();
    const received = [];
    const sub = createEventStream(channel, 'q').subscribe({ next: e => received.push(e) });

    channel._trigger('loan.created', { loanId: 'l1' });
    channel._trigger('user.updated', { userId: 'u1' });

    setTimeout(() => {
      expect(received).toHaveLength(2);
      expect(received[0].routingKey).toBe('loan.created');
      expect(received[1].routingKey).toBe('user.updated');
      sub.unsubscribe();
      done();
    }, 50);
  });

  test('cancels channel consumer on unsubscribe', () => {
    const channel = makeChannel();
    const sub = createEventStream(channel, 'notif-queue').subscribe({ next: () => {} });
    sub.unsubscribe();
    expect(channel.cancel).toHaveBeenCalledWith('notif-queue');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('handleEvent (notification-service)', () => {
  afterEach(() => jest.clearAllMocks());

  const makeNotification = (overrides = {}) => {
    const data = { id: 1, eventType: 'book.created', service: 'book-service', payload: '{}', read: false, ...overrides };
    return { ...data, toJSON: () => data };
  };

  test('creates a Notification record for book.created', async () => {
    Notification.create.mockResolvedValueOnce(makeNotification({ eventType: 'book.created' }));

    await handleEvent({ routingKey: 'book.created', payload: { id: '1' } });

    expect(Notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'book.created', service: 'book-service', read: false })
    );
  });

  test('creates a Notification record for loan.created', async () => {
    Notification.create.mockResolvedValueOnce(makeNotification({ eventType: 'loan.created', service: 'loan-service' }));

    await handleEvent({ routingKey: 'loan.created', payload: { loanId: 'l1' } });

    expect(Notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'loan.created', service: 'loan-service' })
    );
  });

  test('creates a Notification for user.updated with user-service', async () => {
    Notification.create.mockResolvedValueOnce(makeNotification({ eventType: 'user.updated', service: 'user-service' }));

    await handleEvent({ routingKey: 'user.updated', payload: { userId: 'u1' } });

    expect(Notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'user-service' })
    );
  });

  test('uses "unknown" service for unrecognised routing key prefix', async () => {
    Notification.create.mockResolvedValueOnce(makeNotification({ eventType: 'foo.bar', service: 'unknown' }));

    await handleEvent({ routingKey: 'foo.bar', payload: {} });

    expect(Notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'unknown' })
    );
  });

  test('JSON-stringifies object payloads', async () => {
    Notification.create.mockResolvedValueOnce(makeNotification());

    await handleEvent({ routingKey: 'book.created', payload: { id: '5', title: 'DDD' } });

    const callArg = Notification.create.mock.calls[0][0];
    expect(typeof callArg.payload).toBe('string');
    expect(callArg.payload).toContain('DDD');
  });

  test('keeps string payloads as-is', async () => {
    Notification.create.mockResolvedValueOnce(makeNotification({ payload: 'raw-string' }));

    await handleEvent({ routingKey: 'book.created', payload: 'raw-string' });

    const callArg = Notification.create.mock.calls[0][0];
    expect(callArg.payload).toBe('raw-string');
  });

  test('pushes notification to notificationSubject', done => {
    const notifData = { id: 99, eventType: 'loan.returned', service: 'loan-service' };
    Notification.create.mockResolvedValueOnce({ ...notifData, toJSON: () => notifData });

    const sub = mockSubject.subscribe(value => {
      expect(value).toEqual(notifData);
      sub.unsubscribe();
      done();
    });

    handleEvent({ routingKey: 'loan.returned', payload: {} });
  });
});
