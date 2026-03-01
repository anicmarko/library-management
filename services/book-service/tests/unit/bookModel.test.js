const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../../src/index');
const Book = require('../../src/models/bookModel');

jest.mock('../../src/messaging/publisher', () => ({
  connect: jest.fn().mockResolvedValue(true),
  publishBookCreated: jest.fn().mockResolvedValue(true),
  publishBookUpdated: jest.fn().mockResolvedValue(true),
  publishBookDeleted: jest.fn().mockResolvedValue(true),
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
  requestLogger: (req, res, next) => next()
}));

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany();
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Book Model', () => {
  test('should create a valid book', async () => {
    const bookData = {
      title: 'Test Book',
      author: 'Test Author',
      isbn: '978-0000000001',
      available: true
    };

    const book = new Book(bookData);
    const savedBook = await book.save();

    expect(savedBook._id).toBeDefined();
    expect(savedBook.title).toBe(bookData.title);
    expect(savedBook.author).toBe(bookData.author);
    expect(savedBook.isbn).toBe(bookData.isbn);
    expect(savedBook.available).toBe(true);
    expect(savedBook.createdAt).toBeDefined();
    expect(savedBook.updatedAt).toBeDefined();
  });

  test('should fail without required title', async () => {
    const book = new Book({
      author: 'Test Author',
      isbn: '978-0000000002'
    });

    let error;
    try {
      await book.save();
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error.errors.title).toBeDefined();
  });

  test('should fail without required author', async () => {
    const book = new Book({
      title: 'Test Book',
      isbn: '978-0000000003'
    });

    let error;
    try {
      await book.save();
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error.errors.author).toBeDefined();
  });

  test('should fail without required isbn', async () => {
    const book = new Book({
      title: 'Test Book',
      author: 'Test Author'
    });

    let error;
    try {
      await book.save();
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error.errors.isbn).toBeDefined();
  });

  test('should fail with duplicate isbn', async () => {
    const bookData = {
      title: 'Test Book',
      author: 'Test Author',
      isbn: '978-0000000004'
    };

    await new Book(bookData).save();

    const duplicateBook = new Book({
      title: 'Another Book',
      author: 'Another Author',
      isbn: '978-0000000004'
    });

    let error;
    try {
      await duplicateBook.save();
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error.code).toBe(11000);
  });

  test('should default available to true', async () => {
    const book = new Book({
      title: 'Test Book',
      author: 'Test Author',
      isbn: '978-0000000005'
    });

    const savedBook = await book.save();
    expect(savedBook.available).toBe(true);
  });
});

describe('GET /books', () => {
  test('should return all books', async () => {
    const books = [
      { title: 'Book 1', author: 'Author 1', isbn: '978-0000000011', available: true },
      { title: 'Book 2', author: 'Author 2', isbn: '978-0000000012', available: false }
    ];

    await Book.insertMany(books);

    const response = await request(app)
      .get('/books')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.count).toBe(2);
    expect(response.body.data).toHaveLength(2);
  });

  test('should filter books by availability', async () => {
    const books = [
      { title: 'Available Book', author: 'Author 1', isbn: '978-0000000013', available: true },
      { title: 'Unavailable Book', author: 'Author 2', isbn: '978-0000000014', available: false }
    ];

    await Book.insertMany(books);

    const response = await request(app)
      .get('/books?available=true')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.count).toBe(1);
    expect(response.body.data[0].available).toBe(true);
  });

  test('should return empty array when no books exist', async () => {
    const response = await request(app)
      .get('/books')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.count).toBe(0);
    expect(response.body.data).toHaveLength(0);
  });
});

describe('GET /books/:id', () => {
  test('should return a single book by id', async () => {
    const book = await new Book({
      title: 'Single Book',
      author: 'Single Author',
      isbn: '978-0000000021'
    }).save();

    const response = await request(app)
      .get(`/books/${book._id}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.title).toBe('Single Book');
    expect(response.body.data._id).toBe(book._id.toString());
  });

  test('should return 404 for non-existent book', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const response = await request(app)
      .get(`/books/${fakeId}`)
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Book not found');
  });

  test('should return 404 for invalid id format', async () => {
    const response = await request(app)
      .get('/books/invalid-id')
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Book not found');
  });
});

describe('POST /books', () => {
  test('should create a new book', async () => {
    const newBook = {
      title: 'New Book',
      author: 'New Author',
      isbn: '978-0000000031'
    };

    const response = await request(app)
      .post('/books')
      .send(newBook)
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.title).toBe(newBook.title);
    expect(response.body.data.author).toBe(newBook.author);
    expect(response.body.data.isbn).toBe(newBook.isbn);
    expect(response.body.data.available).toBe(true);
    expect(response.body.data._id).toBeDefined();

    const savedBook = await Book.findById(response.body.data._id);
    expect(savedBook).toBeDefined();
  });

  test('should create book with custom availability', async () => {
    const newBook = {
      title: 'Unavailable Book',
      author: 'Author',
      isbn: '978-0000000032',
      available: false
    };

    const response = await request(app)
      .post('/books')
      .send(newBook)
      .expect(201);

    expect(response.body.data.available).toBe(false);
  });

  test('should return 422 when title is missing', async () => {
    const invalidBook = {
      author: 'Author',
      isbn: '978-0000000033'
    };

    const response = await request(app)
      .post('/books')
      .send(invalidBook)
      .expect(422);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Validation failed');
    expect(response.body.details.title).toBeDefined();
  });

  test('should return 422 when author is missing', async () => {
    const invalidBook = {
      title: 'Book',
      isbn: '978-0000000034'
    };

    const response = await request(app)
      .post('/books')
      .send(invalidBook)
      .expect(422);

    expect(response.body.success).toBe(false);
    expect(response.body.details.author).toBeDefined();
  });

  test('should return 422 when isbn is missing', async () => {
    const invalidBook = {
      title: 'Book',
      author: 'Author'
    };

    const response = await request(app)
      .post('/books')
      .send(invalidBook)
      .expect(422);

    expect(response.body.success).toBe(false);
    expect(response.body.details.isbn).toBeDefined();
  });

  test('should return 422 for duplicate isbn', async () => {
    const book = {
      title: 'First Book',
      author: 'Author',
      isbn: '978-0000000035'
    };

    await request(app).post('/books').send(book).expect(201);

    const duplicateBook = {
      title: 'Second Book',
      author: 'Another Author',
      isbn: '978-0000000035'
    };

    const response = await request(app)
      .post('/books')
      .send(duplicateBook)
      .expect(422);

    expect(response.body.success).toBe(false);
    expect(response.body.details.isbn).toBe('ISBN already exists');
  });
});

describe('PUT /books/:id', () => {
  test('should update an existing book', async () => {
    const book = await new Book({
      title: 'Original Title',
      author: 'Original Author',
      isbn: '978-0000000041'
    }).save();

    const updates = {
      title: 'Updated Title',
      author: 'Updated Author'
    };

    const response = await request(app)
      .put(`/books/${book._id}`)
      .send(updates)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.title).toBe('Updated Title');
    expect(response.body.data.author).toBe('Updated Author');
    expect(response.body.data.isbn).toBe('978-0000000041');
  });

  test('should update book availability', async () => {
    const book = await new Book({
      title: 'Book',
      author: 'Author',
      isbn: '978-0000000042',
      available: true
    }).save();

    const response = await request(app)
      .put(`/books/${book._id}`)
      .send({ available: false })
      .expect(200);

    expect(response.body.data.available).toBe(false);
  });

  test('should return 404 for non-existent book', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const response = await request(app)
      .put(`/books/${fakeId}`)
      .send({ title: 'Updated' })
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Book not found');
  });

  test('should return 422 for duplicate isbn', async () => {
    await new Book({
      title: 'Book 1',
      author: 'Author 1',
      isbn: '978-0000000043'
    }).save();

    const book2 = await new Book({
      title: 'Book 2',
      author: 'Author 2',
      isbn: '978-0000000044'
    }).save();

    const response = await request(app)
      .put(`/books/${book2._id}`)
      .send({ isbn: '978-0000000043' })
      .expect(422);

    expect(response.body.success).toBe(false);
    expect(response.body.details.isbn).toBe('ISBN already exists');
  });
});

describe('DELETE /books/:id', () => {
  test('should delete an existing book', async () => {
    const book = await new Book({
      title: 'Book to Delete',
      author: 'Author',
      isbn: '978-0000000051'
    }).save();

    const response = await request(app)
      .delete(`/books/${book._id}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Book deleted successfully');

    const deletedBook = await Book.findById(book._id);
    expect(deletedBook).toBeNull();
  });

  test('should return 404 for non-existent book', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const response = await request(app)
      .delete(`/books/${fakeId}`)
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Book not found');
  });

  test('should return 404 for invalid id format', async () => {
    const response = await request(app)
      .delete('/books/invalid-id')
      .expect(404);

    expect(response.body.success).toBe(false);
  });
});

describe('GET /health', () => {
  test('should return health status', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('book-service');
    expect(response.body.timestamp).toBeDefined();
    expect(response.body.db).toBeDefined();
  });
});

describe('404 handler', () => {
  test('should return 404 for undefined routes', async () => {
    const response = await request(app)
      .get('/nonexistent')
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toBe('Route not found');
  });
});
