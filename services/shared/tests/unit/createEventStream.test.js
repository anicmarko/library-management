'use strict';

const { createEventStream } = require('../../src/createEventStream');

const mockLogger = {
  error: jest.fn(),
};

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
    _triggerBadJson: (routingKey = 'book.created') => {
      if (consumeCallback) {
        consumeCallback({
          content: Buffer.from('not-valid-json'),
          fields: { routingKey },
        });
      }
    },
  };
};

describe('createEventStream', () => {
  afterEach(() => jest.clearAllMocks());

  test('emits { routingKey, payload } for a valid message', done => {
    const channel = makeChannel();
    const stream$ = createEventStream(channel, 'test-queue', mockLogger);

    const sub = stream$.subscribe({
      next: event => {
        expect(event.routingKey).toBe('book.created');
        expect(event.payload).toEqual({ id: '42' });
        expect(channel.ack).toHaveBeenCalledTimes(1);
        sub.unsubscribe();
        done();
      },
    });

    channel._trigger('book.created', { id: '42' });
  });

  test('emits multiple events in sequence', done => {
    const channel = makeChannel();
    const received = [];
    const stream$ = createEventStream(channel, 'test-queue', mockLogger);

    const sub = stream$.subscribe({
      next: event => {
        received.push(event);
        if (received.length === 2) {
          expect(received[0].routingKey).toBe('loan.created');
          expect(received[1].routingKey).toBe('user.updated');
          expect(channel.ack).toHaveBeenCalledTimes(2);
          sub.unsubscribe();
          done();
        }
      },
    });

    channel._trigger('loan.created', { loanId: 'l1' });
    channel._trigger('user.updated', { userId: 'u1' });
  });

  test('ignores null messages (consumer cancellation signal)', done => {
    const channel = makeChannel();
    const received = [];
    const sub = createEventStream(channel, 'test-queue', mockLogger)
      .subscribe({ next: e => received.push(e) });

    channel._triggerNull();

    setTimeout(() => {
      expect(received).toHaveLength(0);
      expect(channel.ack).not.toHaveBeenCalled();
      sub.unsubscribe();
      done();
    }, 50);
  });

  test('recovers silently from JSON parse error (catchError swallows it)', done => {
    const channel = makeChannel();
    const received = [];
    const errors = [];
    const sub = createEventStream(channel, 'test-queue', mockLogger).subscribe({
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

  test('logs the error when catchError fires', done => {
    const channel = makeChannel();
    createEventStream(channel, 'test-queue', mockLogger).subscribe({ next: () => {} });

    // retry(3) resubscribes synchronously each time subscriber.error() is called,
    // so _triggerBadJson() updates consumeCallback immediately via channel.consume.
    // We must exhaust all 4 attempts (original + 3 retries) to reach catchError.
    channel._triggerBadJson();
    channel._triggerBadJson();
    channel._triggerBadJson();
    channel._triggerBadJson();

    setTimeout(() => {
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[reactive] Event stream error',
        expect.objectContaining({ error: expect.any(String) })
      );
      done();
    }, 50);
  });

  test('cancels the channel consumer on unsubscribe (teardown)', () => {
    const channel = makeChannel();
    const sub = createEventStream(channel, 'my-queue', mockLogger)
      .subscribe({ next: () => {} });

    sub.unsubscribe();

    expect(channel.cancel).toHaveBeenCalledWith('my-queue');
  });
});
