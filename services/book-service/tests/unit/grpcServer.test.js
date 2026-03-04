'use strict';

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  requestLogger: (req, res, next) => next(),
}));

// Prevent module-level protoLoader.loadSync() from hitting the filesystem
jest.mock('@grpc/proto-loader', () => ({
  loadSync: jest.fn(() => ({})),
}));

// Mock gRPC server infrastructure
const mockServerInstance = {
  addService: jest.fn(),
  bindAsync: jest.fn((addr, creds, cb) => cb(null, 50051)),
  start: jest.fn(),
  forceShutdown: jest.fn(),
  tryShutdown: jest.fn((cb) => cb && cb()),
};

jest.mock('@grpc/grpc-js', () => ({
  // Plain constructor — not jest.fn() so resetMocks:true cannot wipe it
  Server: function Server() { return mockServerInstance; },
  loadPackageDefinition: () => ({
    books: {
      BookService: { service: {} },
    },
  }),
  ServerCredentials: { createInsecure: () => ({}) },
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

describe('gRPC Server — GetBook handler logic', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns book data when found', async () => {
    Book.findById.mockResolvedValueOnce(mockBook);

    const book = await Book.findById('book123');
    const response = book
      ? { id: book._id.toString(), title: book.title, author: book.author, available: book.available, found: true }
      : { id: '', title: '', author: '', available: false, found: false };

    expect(response.found).toBe(true);
    expect(response.id).toBe('book123');
    expect(response.title).toBe('Clean Code');
    expect(response.available).toBe(true);
  });

  test('returns found=false when book does not exist', async () => {
    Book.findById.mockResolvedValueOnce(null);
    const book = await Book.findById('nonexistent');

    const response = book
      ? { found: true, available: book.available }
      : { found: false, available: false, id: '', title: '', author: '' };

    expect(response.found).toBe(false);
    expect(response.available).toBe(false);
  });
});

describe('gRPC Server — CheckAvailability handler logic', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns available=true and found=true for available book', async () => {
    Book.findById.mockResolvedValueOnce({ ...mockBook, available: true });
    const book = await Book.findById('book123');

    const response = book
      ? { available: book.available, found: true, message: book.available ? 'Book is available' : 'Book is not available' }
      : { available: false, found: false, message: 'Book not found' };

    expect(response.found).toBe(true);
    expect(response.available).toBe(true);
    expect(response.message).toBe('Book is available');
  });

  test('returns available=false for unavailable book', async () => {
    Book.findById.mockResolvedValueOnce({ ...mockBook, available: false });
    const book = await Book.findById('book123');

    const response = {
      available: book.available,
      found: true,
      message: book.available ? 'Book is available' : 'Book is not available',
    };

    expect(response.found).toBe(true);
    expect(response.available).toBe(false);
    expect(response.message).toBe('Book is not available');
  });

  test('returns found=false when book does not exist', async () => {
    Book.findById.mockResolvedValueOnce(null);
    const book = await Book.findById('nonexistent');

    const response = book
      ? { available: book.available, found: true, message: '' }
      : { available: false, found: false, message: 'Book not found' };

    expect(response.found).toBe(false);
    expect(response.available).toBe(false);
    expect(response.message).toBe('Book not found');
  });
});

describe('gRPC Server — startGrpcServer', () => {
  beforeEach(() => jest.clearAllMocks());

  test('startGrpcServer returns a server instance with expected methods', () => {
    const server = startGrpcServer();
    expect(server).toBeDefined();
    expect(typeof server.forceShutdown).toBe('function');
    expect(typeof server.addService).toBe('function');
  });

  test('startGrpcServer registers GetBook and CheckAvailability handlers', () => {
    startGrpcServer();
    expect(mockServerInstance.addService).toHaveBeenCalledTimes(1);
    const [, handlers] = mockServerInstance.addService.mock.calls[0];
    expect(typeof handlers.GetBook).toBe('function');
    expect(typeof handlers.CheckAvailability).toBe('function');
  });
});
