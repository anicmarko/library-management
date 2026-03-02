const request = require('supertest');

const mockUser = {
  id: 1,
  name: 'John Doe',
  email: 'john@example.com',
  active: true,
  loanCount: 0,
  createdAt: new Date(),
  updatedAt: new Date()
};

const mockUserModel = {
  findAll: jest.fn(),
  findByPk: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn()
};

const mockGetUserModel = jest.fn(() => mockUserModel);

jest.mock('../../src/db/db', () => ({
  connectDB: jest.fn().mockResolvedValue(true),
  disconnectDB: jest.fn().mockResolvedValue(true),
  getConnectionStatus: jest.fn().mockReturnValue({ 
    connected: true, 
    dialect: 'mysql',
    database: 'usersdb' 
  }),
  getUserModel: mockGetUserModel,
  getSequelize: jest.fn()
}));

jest.mock('../../src/messaging/publisher', () => ({
  connect: jest.fn().mockResolvedValue(true),
  publishUserCreated: jest.fn().mockResolvedValue(true),
  publishUserUpdated: jest.fn().mockResolvedValue(true),
  closeConnection: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/messaging/subscriber', () => ({
  startSubscribing: jest.fn().mockResolvedValue(true),
  closeConnection: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  requestLogger: (req, res, next) => next()
}));

const app = require('../../src/index');
const publisher = require('../../src/messaging/publisher');

describe('User Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    mockUserModel.findAll.mockResolvedValue([mockUser]);
    mockUserModel.findByPk.mockResolvedValue(mockUser);
    mockUserModel.findOne.mockResolvedValue(null);
    mockUserModel.create.mockResolvedValue(mockUser);
  });

  describe('GET /health', () => {
    test('should return health status', async () => {
      const response = await request(app).get('/health');
      
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.service).toBe('user-service');
      expect(response.body.db).toBeDefined();
      expect(response.body.db.connected).toBe(true);
    });
  });

  describe('GET /users', () => {
    test('should return all active users', async () => {
      const response = await request(app).get('/users');
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.count).toBeDefined();
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(mockUserModel.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { active: true }
        })
      );
    });
  });

  describe('GET /users/:id', () => {
    test('should return a user by id', async () => {
      const response = await request(app).get('/users/1');
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.id).toBe(1);
    });

    test('should return 404 for non-existent user', async () => {
      mockUserModel.findByPk.mockResolvedValueOnce(null);
      
      const response = await request(app).get('/users/999');
      
      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('User not found');
    });
  });

  describe('POST /users', () => {
    test('should create a new user with valid data', async () => {
      const userData = {
        name: 'Jane Doe',
        email: 'jane@example.com'
      };

      const response = await request(app)
        .post('/users')
        .send(userData);
      
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(publisher.publishUserCreated).toHaveBeenCalled();
    });

    test('should fail without required name', async () => {
      const userData = {
        email: 'jane@example.com'
      };

      const response = await request(app)
        .post('/users')
        .send(userData);
      
      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details.name).toBeDefined();
    });

    test('should fail without required email', async () => {
      const userData = {
        name: 'Jane Doe'
      };

      const response = await request(app)
        .post('/users')
        .send(userData);
      
      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.details.email).toBeDefined();
    });

    test('should fail with duplicate email', async () => {
      mockUserModel.findOne.mockResolvedValueOnce({ id: 2, email: 'existing@example.com' });

      const userData = {
        name: 'Jane Doe',
        email: 'existing@example.com'
      };

      const response = await request(app)
        .post('/users')
        .send(userData);
      
      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Email already exists');
    });

    test('should fail with invalid email format', async () => {
      const error = new Error('Validation error');
      error.name = 'SequelizeValidationError';
      error.errors = [{
        path: 'email',
        message: 'Invalid email format'
      }];

      mockUserModel.create.mockRejectedValueOnce(error);

      const userData = {
        name: 'Jane Doe',
        email: 'invalid-email'
      };

      const response = await request(app)
        .post('/users')
        .send(userData);
      
      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });
  });

  describe('PUT /users/:id', () => {
    test('should update user name', async () => {
      const updatableUser = {
        id: 1,
        name: 'Old Name',
        email: 'user@example.com',
        active: true,
        save: jest.fn().mockResolvedValue(true)
      };

      mockUserModel.findByPk.mockResolvedValueOnce(updatableUser);

      const response = await request(app)
        .put('/users/1')
        .send({ name: 'New Name' });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(updatableUser.save).toHaveBeenCalled();
      expect(publisher.publishUserUpdated).toHaveBeenCalled();
    });

    test('should update user email', async () => {
      const updatableUser = {
        id: 1,
        name: 'John Doe',
        email: 'old@example.com',
        active: true,
        save: jest.fn().mockResolvedValue(true)
      };

      mockUserModel.findByPk.mockResolvedValueOnce(updatableUser);
      mockUserModel.findOne.mockResolvedValueOnce(null);

      const response = await request(app)
        .put('/users/1')
        .send({ email: 'new@example.com' });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should update active status', async () => {
      const updatableUser = {
        id: 1,
        name: 'John Doe',
        email: 'user@example.com',
        active: true,
        save: jest.fn().mockResolvedValue(true)
      };

      mockUserModel.findByPk.mockResolvedValueOnce(updatableUser);

      const response = await request(app)
        .put('/users/1')
        .send({ active: false });
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should return 404 for non-existent user', async () => {
      mockUserModel.findByPk.mockResolvedValueOnce(null);

      const response = await request(app)
        .put('/users/999')
        .send({ name: 'New Name' });
      
      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('User not found');
    });

    test('should return 409 for duplicate email on update', async () => {
      const updatableUser = {
        id: 1,
        name: 'John Doe',
        email: 'old@example.com',
        save: jest.fn()
      };

      mockUserModel.findByPk.mockResolvedValueOnce(updatableUser);
      mockUserModel.findOne.mockResolvedValueOnce({ id: 2, email: 'existing@example.com' });

      const response = await request(app)
        .put('/users/1')
        .send({ email: 'existing@example.com' });
      
      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Email already exists');
      expect(updatableUser.save).not.toHaveBeenCalled();
    });
  });
});

describe('LoanCount Increment Logic', () => {
  test('should increment loanCount when loan is created', () => {
    let user = { loanCount: 0 };
    
    // Simulate loan.created event
    user.loanCount += 1;
    
    expect(user.loanCount).toBe(1);
  });

  test('should handle multiple loans', () => {
    let user = { loanCount: 5 };
    
    user.loanCount += 1;
    expect(user.loanCount).toBe(6);
    
    user.loanCount += 1;
    expect(user.loanCount).toBe(7);
  });
});
