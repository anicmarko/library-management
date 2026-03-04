'use strict';

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  requestLogger: (req, res, next) => next(),
}));

jest.mock('@grpc/proto-loader', () => ({
  loadSync: jest.fn(() => ({})),
}));

const mockServerInstance = {
  addService: jest.fn(),
  bindAsync: jest.fn((addr, creds, cb) => cb(null, 50051)),
  start: jest.fn(),
  forceShutdown: jest.fn(),
  tryShutdown: jest.fn((cb) => cb && cb()),
};

jest.mock('@grpc/grpc-js', () => ({
  Server: function Server() { return mockServerInstance; },
  loadPackageDefinition: () => ({
    books: { BookService: { service: {} } },
  }),
  ServerCredentials: { createInsecure: () => ({}) },
  status: { INTERNAL: 13 },
}));

jest.mock('../../src/models/bookModel', () => ({
  findById: jest.fn(),
}));

const Book = require('../../src/models/bookModel');
const { startGrpcServer } = require('../../src/grpc/server');

const mockBook = {
  _id: { toString: () => 'book123' },
  title: 'Clean Code',
  author: 'Robert C. Martin',
  available: true,
};

// Helper: call a real registered handler and return { error, response }
function callHandler(handlerName, requestPayload) {
  startGrpcServer();
  const [, handlers] = mockServerInstance.addService.mock.calls[0];
  return new Promise((resolve) => {
    handlers[handlerName]({ request: requestPayload }, (error, response) => {
      resolve({ error, response });
    });
  });
}

describe('gRPC Server — GetBook', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns book data when book is found', async () => {
    Book.findById.mockResolvedValueOnce(mockBook);
    const { error, response } = await callHandler('GetBook', { id: 'book123' });

    expect(error).toBeNull();
    expect(response.found).toBe(true);
    expect(response.id).toBe('book123');
    expect(response.title).toBe('Clean Code');
    expect(response.author).toBe('Robert C. Martin');
    expect(response.available).toBe(true);
  });

  test('returns found=false when book does not exist', async () => {
    Book.findById.mockResolvedValueOnce(null);
    const { error, response } = await callHandler('GetBook', { id: 'missing' });

    expect(error).toBeNull();
    expect(response.found).toBe(false);
    expect(response.available).toBe(false);
    expect(response.id).toBe('');
  });

  test('calls back with INTERNAL error on DB failure', async () => {
    Book.findById.mockRejectedValueOnce(new Error('DB down'));
    const { error } = await callHandler('GetBook', { id: 'book123' });

    expect(error).toBeDefined();
    expect(error.code).toBe(13); // grpc.status.INTERNAL
  });
});

describe('gRPC Server — CheckAvailability', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns available=true for an available book', async () => {
    Book.findById.mockResolvedValueOnce({ ...mockBook, available: true });
    const { error, response } = await callHandler('CheckAvailability', { id: 'book123' });

    expect(error).toBeNull();
    expect(response.found).toBe(true);
    expect(response.available).toBe(true);
    expect(response.message).toBe('Book is available');
  });

  test('returns available=false for an unavailable book', async () => {
    Book.findById.mockResolvedValueOnce({ ...mockBook, available: false });
    const { error, response } = await callHandler('CheckAvailability', { id: 'book123' });

    expect(error).toBeNull();
    expect(response.found).toBe(true);
    expect(response.available).toBe(false);
    expect(response.message).toBe('Book is not available');
  });

  test('returns found=false when book does not exist', async () => {
    Book.findById.mockResolvedValueOnce(null);
    const { error, response } = await callHandler('CheckAvailability', { id: 'missing' });

    expect(error).toBeNull();
    expect(response.found).toBe(false);
    expect(response.available).toBe(false);
    expect(response.message).toBe('Book not found');
  });

  test('calls back with INTERNAL error on DB failure', async () => {
    Book.findById.mockRejectedValueOnce(new Error('DB down'));
    const { error } = await callHandler('CheckAvailability', { id: 'book123' });

    expect(error).toBeDefined();
    expect(error.code).toBe(13); // grpc.status.INTERNAL
  });
});

describe('gRPC Server — startGrpcServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Restore bindAsync default after resetMocks:true wipes it
    mockServerInstance.bindAsync.mockImplementation((addr, creds, cb) => cb(null, 50051));
  });

  test('returns a server instance with expected methods', () => {
    const server = startGrpcServer();
    expect(server).toBeDefined();
    expect(typeof server.forceShutdown).toBe('function');
    expect(typeof server.addService).toBe('function');
  });

  test('registers GetBook and CheckAvailability handlers', () => {
    startGrpcServer();
    expect(mockServerInstance.addService).toHaveBeenCalledTimes(1);
    const [, handlers] = mockServerInstance.addService.mock.calls[0];
    expect(typeof handlers.GetBook).toBe('function');
    expect(typeof handlers.CheckAvailability).toBe('function');
  });

  test('handles bindAsync error gracefully', () => {
    mockServerInstance.bindAsync.mockImplementationOnce((addr, creds, cb) => cb(new Error('port in use'), null));
    expect(() => startGrpcServer()).not.toThrow();
  });
});
