'use strict';

const { createEventStream, handleEvent } = require('../../src/messaging/reactiveSubscriber');

const mockBook = { available: true, save: jest.fn().mockResolvedValue() };

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
        expect(event.bookId).toBe('book-1');
        expect(event._routingKey).toBe('loan.created');
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

    handleEvent({ _routingKey: 'loan.created', bookId: 'b1', loanId: 'l1' }).then(() => {
      expect(Book.findById).toHaveBeenCalledWith('b1');
      done();
    });
  });

  test('marks book available on loan.returned', done => {
    const saveMock = jest.fn().mockResolvedValue();
    Book.findById.mockResolvedValueOnce({ available: false, save: saveMock });

    handleEvent({ _routingKey: 'loan.returned', bookId: 'b2', loanId: 'l2' }).then(() => {
      expect(Book.findById).toHaveBeenCalledWith('b2');
      expect(saveMock).toHaveBeenCalled();
      done();
    });
  });

  test('logs warning when book not found on loan.created', done => {
    Book.findById.mockResolvedValueOnce(null);
    const logger = require('../../src/utils/logger');

    handleEvent({ _routingKey: 'loan.created', bookId: 'missing', loanId: 'l1' }).then(() => {
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Book not found'),
        expect.any(Object)
      );
      done();
    });
  });

  test('does nothing for unrelated routing key', done => {
    handleEvent({ _routingKey: 'user.created', bookId: 'b1' }).then(() => {
      expect(Book.findById).not.toHaveBeenCalled();
      done();
    });
  });
});
