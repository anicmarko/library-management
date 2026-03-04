'use strict';

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('@grpc/proto-loader', () => ({
  loadSync: jest.fn(() => ({})),
}));

const mockCheckAvailability = jest.fn();
const mockClientInstance = { CheckAvailability: mockCheckAvailability };

jest.mock('@grpc/grpc-js', () => {
  const grpc = jest.requireActual('@grpc/grpc-js');
  return {
    ...grpc,
    loadPackageDefinition: jest.fn(() => ({
      books: {
        BookService: jest.fn(() => mockClientInstance),
      },
    })),
    credentials: { createInsecure: jest.fn(() => ({})) },
  };
});

const { checkBookAvailability } = require('../../src/grpc/client');

describe('gRPC Client — checkBookAvailability', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns available=true and found=true for an available book', async () => {
    mockCheckAvailability.mockImplementation((request, options, callback) => {
      callback(null, { available: true, found: true, message: 'Book is available' });
    });

    const result = await checkBookAvailability('book123');

    expect(result.found).toBe(true);
    expect(result.available).toBe(true);
    expect(result.message).toBe('Book is available');
  });

  test('returns available=false and found=true for an unavailable book', async () => {
    mockCheckAvailability.mockImplementation((request, options, callback) => {
      callback(null, { available: false, found: true, message: 'Book is not available' });
    });

    const result = await checkBookAvailability('book456');

    expect(result.found).toBe(true);
    expect(result.available).toBe(false);
    expect(result.message).toBe('Book is not available');
  });

  test('returns found=false when book does not exist', async () => {
    mockCheckAvailability.mockImplementation((request, options, callback) => {
      callback(null, { available: false, found: false, message: 'Book not found' });
    });

    const result = await checkBookAvailability('nonexistent');

    expect(result.found).toBe(false);
    expect(result.available).toBe(false);
  });

  test('gracefully degrades (available=true, found=true) on gRPC timeout', async () => {
    const timeoutError = Object.assign(new Error('Deadline exceeded'), { code: 4 }); // DEADLINE_EXCEEDED
    mockCheckAvailability.mockImplementation((request, options, callback) => {
      callback(timeoutError, null);
    });

    const result = await checkBookAvailability('book123');

    expect(result.available).toBe(true);
    expect(result.found).toBe(true);
  });

  test('gracefully degrades on connection refused', async () => {
    const connError = Object.assign(new Error('Connection refused'), { code: 14 }); // UNAVAILABLE
    mockCheckAvailability.mockImplementation((request, options, callback) => {
      callback(connError, null);
    });

    const result = await checkBookAvailability('book123');

    expect(result.available).toBe(true);
    expect(result.found).toBe(true);
  });

  test('passes the bookId as string in the request', async () => {
    mockCheckAvailability.mockImplementation((request, options, callback) => {
      callback(null, { available: true, found: true, message: '' });
    });

    await checkBookAvailability(42); // numeric bookId

    expect(mockCheckAvailability).toHaveBeenCalledWith(
      { id: '42' },
      expect.any(Object),
      expect.any(Function)
    );
  });
});
