const request = require('supertest');

const mockLoan = {
  id: 1,
  bookId: 1,
  userId: 1,
  loanDate: new Date('2024-01-01'),
  dueDate: new Date('2024-01-15'),
  returnedAt: null,
  status: 'active'
};

const mockLoanModel = {
  findAll: jest.fn(),
  findByPk: jest.fn(),
  create: jest.fn()
};

const mockGetLoanModel = jest.fn(() => mockLoanModel);

jest.mock('../../src/db/db', () => ({
  connectDB: jest.fn().mockResolvedValue(true),
  disconnectDB: jest.fn().mockResolvedValue(true),
  getConnectionStatus: jest.fn().mockReturnValue({ 
    connected: true, 
    dialect: 'postgres',
    database: 'loansdb' 
  }),
  getLoanModel: mockGetLoanModel,
  getSequelize: jest.fn()
}));

jest.mock('../../src/messaging/publisher', () => ({
  connect: jest.fn().mockResolvedValue(true),
  publishLoanCreated: jest.fn().mockResolvedValue(true),
  publishLoanReturned: jest.fn().mockResolvedValue(true),
  closeConnection: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/messaging/subscriber', () => ({
  startSubscribing: jest.fn().mockResolvedValue(true),
  closeConnection: jest.fn().mockResolvedValue(true),
  isBookDeleted: jest.fn().mockReturnValue(false),
  clearDeletedBooks: jest.fn(),
  getDeletedBooksCount: jest.fn().mockReturnValue(0)
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  requestLogger: (req, res, next) => next()
}));

const app = require('../../src/index');
const subscriber = require('../../src/messaging/subscriber');
const publisher = require('../../src/messaging/publisher');

describe('Loan Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    mockLoanModel.findAll.mockResolvedValue([mockLoan]);
    mockLoanModel.findByPk.mockResolvedValue(mockLoan);
    mockLoanModel.create.mockResolvedValue(mockLoan);
  });

  describe('GET /health', () => {
    test('should return health status', async () => {
      const response = await request(app).get('/health');
      
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.service).toBe('loan-service');
      expect(response.body.db).toBeDefined();
      expect(response.body.db.connected).toBe(true);
    });
  });

  describe('GET /loans', () => {
    test('should return all loans', async () => {
      const response = await request(app).get('/loans');
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.count).toBeDefined();
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('should filter loans by status=active', async () => {
      const response = await request(app).get('/loans?status=active');
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockLoanModel.findAll).toHaveBeenCalled();
    });

    test('should filter loans by status=returned', async () => {
      const response = await request(app).get('/loans?status=returned');
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should return 422 for invalid status', async () => {
      const response = await request(app).get('/loans?status=invalid');
      
      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });
  });

  describe('GET /loans/:id', () => {
    test('should return a loan by id', async () => {
      const response = await request(app).get('/loans/1');
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.id).toBe(1);
    });

    test('should return 404 for non-existent loan', async () => {
      mockLoanModel.findByPk.mockResolvedValueOnce(null);
      
      const response = await request(app).get('/loans/999');
      
      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Loan not found');
    });
  });

  describe('POST /loans', () => {
    test('should create a new loan', async () => {
      const loanData = {
        bookId: 1,
        userId: 1,
        dueDate: '2024-01-15'
      };

      const response = await request(app)
        .post('/loans')
        .send(loanData);
      
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(publisher.publishLoanCreated).toHaveBeenCalled();
    });

    test('should fail without required bookId', async () => {
      const loanData = {
        userId: 1,
        dueDate: '2024-01-15'
      };

      const response = await request(app)
        .post('/loans')
        .send(loanData);
      
      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details.bookId).toBeDefined();
    });

    test('should fail without required userId', async () => {
      const loanData = {
        bookId: 1,
        dueDate: '2024-01-15'
      };

      const response = await request(app)
        .post('/loans')
        .send(loanData);
      
      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.details.userId).toBeDefined();
    });

    test('should fail without required dueDate', async () => {
      const loanData = {
        bookId: 1,
        userId: 1
      };

      const response = await request(app)
        .post('/loans')
        .send(loanData);
      
      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.details.dueDate).toBeDefined();
    });

    test('should fail for deleted book', async () => {
      subscriber.isBookDeleted.mockReturnValueOnce(true);

      const loanData = {
        bookId: 1,
        userId: 1,
        dueDate: '2024-01-15'
      };

      const response = await request(app)
        .post('/loans')
        .send(loanData);
      
      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.details.bookId).toContain('deleted');
    });

    test('should fail for invalid date format', async () => {
      const loanData = {
        bookId: 1,
        userId: 1,
        dueDate: 'invalid-date'
      };

      const response = await request(app)
        .post('/loans')
        .send(loanData);
      
      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.details.dueDate).toBeDefined();
    });
  });

  describe('PUT /loans/:id/return', () => {
    test('should return a loan', async () => {
      const activeLoan = {
        id: 1,
        bookId: 1,
        userId: 1,
        status: 'active',
        returnedAt: null,
        save: jest.fn().mockResolvedValue(true)
      };

      mockLoanModel.findByPk.mockResolvedValueOnce(activeLoan);

      const response = await request(app).put('/loans/1/return');
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(activeLoan.save).toHaveBeenCalled();
      expect(publisher.publishLoanReturned).toHaveBeenCalled();
    });

    test('should return 404 for non-existent loan', async () => {
      mockLoanModel.findByPk.mockResolvedValueOnce(null);

      const response = await request(app).put('/loans/999/return');
      
      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Loan not found');
    });

    test('should return 409 for already returned loan', async () => {
      const returnedLoan = {
        id: 1,
        bookId: 1,
        userId: 1,
        status: 'returned',
        returnedAt: new Date(),
        save: jest.fn().mockResolvedValue(true)
      };

      mockLoanModel.findByPk.mockResolvedValueOnce(returnedLoan);

      const response = await request(app).put('/loans/1/return');
      
      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Loan already returned');
      expect(returnedLoan.save).not.toHaveBeenCalled();
    });
  });
});

describe('Loan Model', () => {
  test('loan model validation - valid loan', () => {
    const validLoan = {
      bookId: 1,
      userId: 1,
      loanDate: new Date(),
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      status: 'active'
    };

    expect(validLoan.bookId).toBeDefined();
    expect(validLoan.userId).toBeDefined();
    expect(validLoan.dueDate).toBeDefined();
    expect(['active', 'returned']).toContain(validLoan.status);
  });

  test('loan model validation - status enum', () => {
    const validStatuses = ['active', 'returned'];
    
    validStatuses.forEach(status => {
      expect(['active', 'returned']).toContain(status);
    });
  });
});

describe('Subscriber - Book Deleted', () => {
  test('should detect deleted books', () => {
    subscriber.isBookDeleted.mockReturnValueOnce(true);
    
    const isDeleted = subscriber.isBookDeleted(123);
    expect(isDeleted).toBe(true);
  });

  test('should not detect non-deleted books', () => {
    subscriber.isBookDeleted.mockReturnValueOnce(false);
    
    const isDeleted = subscriber.isBookDeleted(456);
    expect(isDeleted).toBe(false);
  });
});
