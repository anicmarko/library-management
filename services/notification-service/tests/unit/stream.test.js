'use strict';

const { EventEmitter } = require('events');
const { Subject } = require('rxjs');

let innerSubject = new Subject();
const mockSubject = {
  subscribe: (...args) => innerSubject.subscribe(...args),
  next: (...args) => innerSubject.next(...args),
  error: (...args) => innerSubject.error(...args),
  get observers() { return innerSubject.observers; },
};

jest.mock('../../src/messaging/notificationSubject', () => ({
  notificationSubject: mockSubject,
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const streamRouter = require('../../src/routes/stream');

const getSseHandler = () => {
  const layer = streamRouter.stack.find(
    l => l.route && l.route.path === '/notifications/stream'
  );
  return layer.route.stack[0].handle;
};

const makeReqRes = () => {
  const req = Object.assign(new EventEmitter(), { ip: '127.0.0.1' });
  const res = {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  };
  return { req, res };
};

beforeEach(() => {
  innerSubject = new Subject();
});

afterEach(() => jest.clearAllMocks());


describe('GET /notifications/stream — SSE headers', () => {
  test('sets Content-Type: text/event-stream', () => {
    const { req, res } = makeReqRes();
    getSseHandler()(req, res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
  });

  test('sets Cache-Control: no-cache', () => {
    const { req, res } = makeReqRes();
    getSseHandler()(req, res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
  });

  test('sets Connection: keep-alive', () => {
    const { req, res } = makeReqRes();
    getSseHandler()(req, res);
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
  });

  test('sets X-Accel-Buffering: no (disables nginx buffering)', () => {
    const { req, res } = makeReqRes();
    getSseHandler()(req, res);
    expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
  });

  test('calls flushHeaders immediately to start the stream', () => {
    const { req, res } = makeReqRes();
    getSseHandler()(req, res);
    expect(res.flushHeaders).toHaveBeenCalledTimes(1);
  });
});

describe('GET /notifications/stream — data emission', () => {
  test('writes data frame when Subject emits', () => {
    const { req, res } = makeReqRes();
    getSseHandler()(req, res);

    const notification = { id: 1, eventType: 'book.created', service: 'book-service' };
    mockSubject.next(notification);

    expect(res.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify(notification)}\n\n`
    );
  });

  test('writes a frame for every emission', () => {
    const { req, res } = makeReqRes();
    getSseHandler()(req, res);

    mockSubject.next({ id: 1, eventType: 'loan.created' });
    mockSubject.next({ id: 2, eventType: 'user.updated' });

    const frames = res.write.mock.calls.map(c => c[0]);
    expect(frames.some(f => f.includes('loan.created'))).toBe(true);
    expect(frames.some(f => f.includes('user.updated'))).toBe(true);
    expect(frames).toHaveLength(2);
  });

  test('ends response on Subject error', () => {
    const { req, res } = makeReqRes();
    getSseHandler()(req, res);
    mockSubject.error(new Error('stream failure'));
    expect(res.end).toHaveBeenCalled();
  });
});

describe('GET /notifications/stream — heartbeat', () => {
  test('sends heartbeat every 30 s via setInterval', () => {
    jest.useFakeTimers();
    const { req, res } = makeReqRes();
    getSseHandler()(req, res);

    jest.advanceTimersByTime(30_000);
    expect(res.write).toHaveBeenCalledWith(': heartbeat\n\n');

    jest.useRealTimers();
  });
});

describe('GET /notifications/stream — disconnect cleanup', () => {
  test('unsubscribes from Subject on client disconnect', () => {
    const { req, res } = makeReqRes();
    getSseHandler()(req, res);

    const countBefore = innerSubject.observers.length;
    req.emit('close');
    expect(innerSubject.observers.length).toBeLessThan(countBefore);
  });

  test('clears heartbeat interval on client disconnect', () => {
    jest.useFakeTimers();
    const clearSpy = jest.spyOn(global, 'clearInterval');

    const { req, res } = makeReqRes();
    getSseHandler()(req, res);
    req.emit('close');

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
    jest.useRealTimers();
  });
});
