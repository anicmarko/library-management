'use strict';

const { createEventStream, handleEvent, startReactiveSubscribing } = require('../../src/messaging/reactiveSubscriber');

const mockBook = { available: true, save: jest.fn().mockResolvedValue() };

jest.mock('amqplib');

jest.mock('../../src/models/bookModel', () => ({
  findById: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const Book = require('../../src/models/bookModel');

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
          fields: { routingKey: 'loan.created' },
        });
      }
    },
  };
};


describe('createEventStream', () => {
  afterEach(() => jest.clearAllMocks());

  test('emits a parsed event when a message arrives', done => {
    const channel = makeChannel();
    const stream$ = createEventStream(channel, 'test-queue');

    const sub = stream$.subscribe({
      next: event => {
        expect(event.payload.bookId).toBe('book-1');
        expect(event.routingKey).toBe('loan.created');
        expect(channel.ack).toHaveBeenCalledTimes(1);
        sub.unsubscribe();
        done();
      },
    });

    channel._trigger('loan.created', { bookId: 'book-1', loanId: 'loan-1' });
  });

  test('calls channel.ack for each valid message', done => {
    const channel = makeChannel();
    const received = [];
    const stream$ = createEventStream(channel, 'test-queue');

    const sub = stream$.subscribe({
      next: event => {
        received.push(event);
        if (received.length === 2) {
          expect(channel.ack).toHaveBeenCalledTimes(2);
          sub.unsubscribe();
          done();
        }
      },
    });

    channel._trigger('loan.created', { bookId: 'b1' });
    channel._trigger('loan.returned', { bookId: 'b2' });
  });

  test('ignores null messages (queue consumer cancelled)', done => {
    const channel = makeChannel();
    const stream$ = createEventStream(channel, 'test-queue');
    const received = [];

    const sub = stream$.subscribe({ next: e => received.push(e) });

    channel._triggerNull();

    setTimeout(() => {
      expect(received).toHaveLength(0);
      expect(channel.ack).not.toHaveBeenCalled();
      sub.unsubscribe();
      done();
    }, 50);
  });

  test('recovers from JSON parse error and does not emit', done => {
    const channel = makeChannel();
    const stream$ = createEventStream(channel, 'test-queue');
    const received = [];
    const errors = [];

    const sub = stream$.subscribe({
      next: e => received.push(e),
      error: e => errors.push(e),
    });

    channel._triggerBadJson();

    setTimeout(() => {
      expect(received).toHaveLength(0);
      expect(errors).toHaveLength(0); // catchError swallows it
      sub.unsubscribe();
      done();
    }, 50);
  });

  test('calls channel.cancel on unsubscribe (teardown)', () => {
    const channel = makeChannel();
    const stream$ = createEventStream(channel, 'book-service-reactive-queue');
    const sub = stream$.subscribe({ next: () => {} });
    sub.unsubscribe();
    expect(channel.cancel).toHaveBeenCalledWith('book-service-reactive-queue');
  });
});


describe('handleEvent via stream (loan.created)', () => {
  afterEach(() => jest.clearAllMocks());

  test('marks book unavailable on loan.created', done => {
    Book.findById.mockResolvedValueOnce({ ...mockBook, available: true, save: jest.fn().mockResolvedValue() });

    handleEvent({ routingKey: 'loan.created', payload: { bookId: 'b1', loanId: 'l1' } }).then(() => {
      expect(Book.findById).toHaveBeenCalledWith('b1');
      done();
    });
  });

  test('marks book available on loan.returned', done => {
    const saveMock = jest.fn().mockResolvedValue();
    Book.findById.mockResolvedValueOnce({ available: false, save: saveMock });

    handleEvent({ routingKey: 'loan.returned', payload: { bookId: 'b2', loanId: 'l2' } }).then(() => {
      expect(Book.findById).toHaveBeenCalledWith('b2');
      expect(saveMock).toHaveBeenCalled();
      done();
    });
  });

  test('logs warning when book not found on loan.created', done => {
    Book.findById.mockResolvedValueOnce(null);
    const logger = require('../../src/utils/logger');

    handleEvent({ routingKey: 'loan.created', payload: { bookId: 'missing', loanId: 'l1' } }).then(() => {
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Book not found'),
        expect.any(Object)
      );
      done();
    });
  });

  test('does nothing for unrelated routing key', done => {
    handleEvent({ routingKey: 'user.created', payload: { bookId: 'b1' } }).then(() => {
      expect(Book.findById).not.toHaveBeenCalled();
      done();
    });
  });
});


describe('startReactiveSubscribing', () => {
  let amqp;
  let mockChannel;
  let mockConnection;

  beforeEach(() => {
    amqp = require('amqplib');
    mockChannel = {
      assertExchange: jest.fn().mockResolvedValue({}),
      assertQueue:    jest.fn().mockResolvedValue({}),
      bindQueue:      jest.fn().mockResolvedValue({}),
      consume:        jest.fn(),
      ack:            jest.fn(),
      cancel:         jest.fn().mockResolvedValue({}),
    };
    mockConnection = {
      createChannel: jest.fn().mockResolvedValue(mockChannel),
      on: jest.fn(),
    };
    amqp.connect.mockResolvedValue(mockConnection);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  test('connects and sets up exchange, queue and bindings', async () => {
    const sub = await startReactiveSubscribing();

    expect(amqp.connect).toHaveBeenCalled();
    expect(mockChannel.assertExchange).toHaveBeenCalledWith('library.events', 'topic', { durable: true });
    expect(mockChannel.assertQueue).toHaveBeenCalledWith('book-service-reactive-queue', { durable: true });
    expect(mockChannel.bindQueue).toHaveBeenCalledWith('book-service-reactive-queue', 'library.events', 'loan.created');
    expect(mockChannel.bindQueue).toHaveBeenCalledWith('book-service-reactive-queue', 'library.events', 'loan.returned');

    if (sub) sub.unsubscribe();
  });

  test('registers connection close handler', async () => {
    const sub = await startReactiveSubscribing();

    expect(mockConnection.on).toHaveBeenCalledWith('close', expect.any(Function));

    if (sub) sub.unsubscribe();
  });

  test('schedules reconnect when connection closes', async () => {
    jest.useFakeTimers();
    const sub = await startReactiveSubscribing();

    const closeHandler = mockConnection.on.mock.calls.find(c => c[0] === 'close')[1];
    if (sub) sub.unsubscribe();
    closeHandler();

    expect(jest.getTimerCount()).toBeGreaterThan(0);
  });

  test('schedules reconnect and logs on connect failure', async () => {
    jest.useFakeTimers();
    const logger = require('../../src/utils/logger');
    amqp.connect.mockRejectedValueOnce(new Error('connection refused'));

    await startReactiveSubscribing();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to start'),
      expect.any(Object)
    );
    expect(jest.getTimerCount()).toBeGreaterThan(0);
  });
});
