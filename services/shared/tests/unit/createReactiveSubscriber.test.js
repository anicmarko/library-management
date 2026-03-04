'use strict';

jest.mock('amqplib');

const amqp = require('amqplib');
const { createReactiveSubscriber } = require('../../src/createReactiveSubscriber');

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const mockHandleEvent = jest.fn().mockResolvedValue();

const makeConnection = () => {
  const listeners = {};
  const channel = {
    assertExchange: jest.fn().mockResolvedValue({}),
    assertQueue:    jest.fn().mockResolvedValue({}),
    bindQueue:      jest.fn().mockResolvedValue({}),
    consume:        jest.fn(),
    ack:            jest.fn(),
    cancel:         jest.fn().mockResolvedValue({}),
  };
  const connection = {
    createChannel: jest.fn().mockResolvedValue(channel),
    on: jest.fn((event, cb) => { listeners[event] = cb; }),
    _emit: (event) => listeners[event] && listeners[event](),
    _channel: channel,
  };
  return connection;
};

describe('createReactiveSubscriber', () => {
  let mockConnection;

  beforeEach(() => {
    jest.useFakeTimers();
    mockConnection = makeConnection();
    amqp.connect.mockResolvedValue(mockConnection);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('connects and asserts exchange, queue, and all routing keys', async () => {
    const { startReactiveSubscribing } = createReactiveSubscriber({
      queueName: 'test-queue',
      routingKeys: ['a.created', 'b.updated'],
      handleEvent: mockHandleEvent,
      logger: mockLogger,
    });

    const sub = await startReactiveSubscribing();

    const ch = mockConnection._channel;
    expect(amqp.connect).toHaveBeenCalledWith(expect.any(String));
    expect(ch.assertExchange).toHaveBeenCalledWith('library.events', 'topic', { durable: true });
    expect(ch.assertQueue).toHaveBeenCalledWith('test-queue', { durable: true });
    expect(ch.bindQueue).toHaveBeenCalledWith('test-queue', 'library.events', 'a.created');
    expect(ch.bindQueue).toHaveBeenCalledWith('test-queue', 'library.events', 'b.updated');
    if (sub) sub.unsubscribe();
  });

  test('respects a custom exchangeName option', async () => {
    const { startReactiveSubscribing } = createReactiveSubscriber({
      queueName: 'test-queue',
      routingKeys: ['x.done'],
      handleEvent: mockHandleEvent,
      logger: mockLogger,
      exchangeName: 'custom.exchange',
    });

    const sub = await startReactiveSubscribing();

    expect(mockConnection._channel.assertExchange).toHaveBeenCalledWith(
      'custom.exchange', 'topic', { durable: true }
    );
    if (sub) sub.unsubscribe();
  });

  test('registers a close handler on the connection', async () => {
    const { startReactiveSubscribing } = createReactiveSubscriber({
      queueName: 'test-queue',
      routingKeys: ['a.created'],
      handleEvent: mockHandleEvent,
      logger: mockLogger,
    });

    const sub = await startReactiveSubscribing();

    expect(mockConnection.on).toHaveBeenCalledWith('close', expect.any(Function));
    if (sub) sub.unsubscribe();
  });

  test('schedules reconnect when connection closes', async () => {
    const { startReactiveSubscribing } = createReactiveSubscriber({
      queueName: 'test-queue',
      routingKeys: ['a.created'],
      handleEvent: mockHandleEvent,
      logger: mockLogger,
      retryDelayMs: 3000,
    });

    const sub = await startReactiveSubscribing();
    if (sub) sub.unsubscribe();

    mockConnection._emit('close');

    expect(mockLogger.warn).toHaveBeenCalledWith('[reactive] Connection closed, restarting');
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    jest.advanceTimersByTime(3000);
    expect(amqp.connect).toHaveBeenCalledTimes(2);
  });

  test('schedules reconnect and logs on connect failure', async () => {
    amqp.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const { startReactiveSubscribing } = createReactiveSubscriber({
      queueName: 'test-queue',
      routingKeys: ['a.created'],
      handleEvent: mockHandleEvent,
      logger: mockLogger,
      retryDelayMs: 3000,
    });

    await startReactiveSubscribing();

    expect(mockLogger.error).toHaveBeenCalledWith(
      '[reactive] Failed to start reactive subscriber',
      expect.objectContaining({ error: 'ECONNREFUSED' })
    );
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    jest.advanceTimersByTime(3000);
    expect(amqp.connect).toHaveBeenCalledTimes(2);
  });
});
