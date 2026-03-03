require('./tracing');
require('dotenv').config();
const express = require('express');
const { trace } = require('@opentelemetry/api');
const logger = require('./utils/logger');
const { requestLogger } = require('./utils/logger');
const { connectDB, getConnectionStatus, disconnectDB } = require('./db/db');
const publisher = require('./messaging/publisher');
const subscriber = require('./messaging/subscriber');
const Book = require('./models/bookModel');
const { register, metricsMiddleware } = require('./metrics');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use(metricsMiddleware);

app.use((req, res, next) => {
  const activeSpan = trace.getActiveSpan();
  const traceId = activeSpan
    ? activeSpan.spanContext().traceId
    : (req.headers['x-trace-id'] || require('crypto').randomUUID());
  req.traceId = traceId;
  res.setHeader('x-trace-id', traceId);
  next();
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'book-service',
    timestamp: new Date().toISOString(),
    db: getConnectionStatus()
  });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});


app.get('/books', async (req, res) => {
  try {
    const { available } = req.query;
    const filter = {};

    if (available !== undefined) {
      filter.available = available === 'true';
    }

    const books = await Book.find(filter).sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: books.length,
      data: books
    });
  } catch (error) {
    logger.error('Error fetching books', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});


app.get('/books/:id', async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);

    if (!book) {
      return res.status(404).json({
        success: false,
        error: 'Book not found'
      });
    }

    res.json({
      success: true,
      data: book
    });
  } catch (error) {
    logger.error('Error fetching book', { error: error.message, bookId: req.params.id });
    
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        error: 'Book not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.post('/books', async (req, res) => {
  try {
    const { title, author, isbn, available } = req.body;

    if (!title || !author || !isbn) {
      const details = {};
      if (!title) details.title = 'Title is required';
      if (!author) details.author = 'Author is required';
      if (!isbn) details.isbn = 'ISBN is required';

      return res.status(422).json({
        success: false,
        error: 'Validation failed',
        details
      });
    }

    const existingBook = await Book.findOne({ isbn });
    if (existingBook) {
      return res.status(422).json({
        success: false,
        error: 'Validation failed',
        details: {
          isbn: 'ISBN already exists'
        }
      });
    }

    const book = new Book({
      title,
      author,
      isbn,
      available: available === undefined ? true : available
    });

    await book.save();

    try {
      await publisher.publishBookCreated(book);
    } catch (publishError) {
      logger.error('Failed to publish book.created event', { 
        error: publishError.message,
        bookId: book._id 
      });
    }

    res.status(201).json({
      success: true,
      data: book
    });

  } catch (error) {
    logger.error('Error creating book', { error: error.message });

    if (error.name === 'ValidationError') {
      const details = {};
      Object.keys(error.errors).forEach(key => {
        details[key] = error.errors[key].message;
      });

      return res.status(422).json({
        success: false,
        error: 'Validation failed',
        details
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.put('/books/:id', async (req, res) => {
  try {
    const { title, author, isbn, available } = req.body;

    const book = await Book.findById(req.params.id);

    if (!book) {
      return res.status(404).json({
        success: false,
        error: 'Book not found'
      });
    }

    if (isbn && isbn !== book.isbn) {
      const existingBook = await Book.findOne({ isbn });
      if (existingBook) {
        return res.status(422).json({
          success: false,
          error: 'Validation failed',
          details: {
            isbn: 'ISBN already exists'
          }
        });
      }
    }

    if (title !== undefined) book.title = title;
    if (author !== undefined) book.author = author;
    if (isbn !== undefined) book.isbn = isbn;
    if (available !== undefined) book.available = available;

    await book.save();

    try {
      await publisher.publishBookUpdated(book);
    } catch (publishError) {
      logger.error('Failed to publish book.updated event', { 
        error: publishError.message,
        bookId: book._id 
      });
    }

    res.json({
      success: true,
      data: book
    });

  } catch (error) {
    logger.error('Error updating book', { error: error.message, bookId: req.params.id });

    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        error: 'Book not found'
      });
    }

    if (error.name === 'ValidationError') {
      const details = {};
      Object.keys(error.errors).forEach(key => {
        details[key] = error.errors[key].message;
      });

      return res.status(422).json({
        success: false,
        error: 'Validation failed',
        details
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.delete('/books/:id', async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);

    if (!book) {
      return res.status(404).json({
        success: false,
        error: 'Book not found'
      });
    }

    const bookId = book._id;
    const bookTitle = book.title;

    await Book.findByIdAndDelete(req.params.id);

    try {
      await publisher.publishBookDeleted(bookId, bookTitle);
    } catch (publishError) {
      logger.error('Failed to publish book.deleted event', { 
        error: publishError.message,
        bookId 
      });
    }

    res.json({
      success: true,
      message: 'Book deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting book', { error: error.message, bookId: req.params.id });

    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        error: 'Book not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

app.use((err, req, res, _next) => {
  logger.error('Unhandled error', { 
    error: err.message, 
    stack: err.stack,
    path: req.path 
  });

  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

const startServer = async () => {
  try {
    await connectDB();
    logger.info('Database connected');

    await publisher.connect();
    logger.info('RabbitMQ publisher connected');

    await subscriber.startSubscribing();
    logger.info('RabbitMQ subscriber started');

    const server = app.listen(PORT, () => {
      logger.info(`Book service running on port ${PORT}`);
    });

    const gracefulShutdown = async (signal) => {
      logger.info(`${signal} received, shutting down gracefully`);
      
      server.close(async () => {
        logger.info('HTTP server closed');
        
        await publisher.closeConnection();
        await subscriber.closeConnection();
        await disconnectDB();
        
        logger.info('All connections closed');
        process.exit(0);
      });

      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

module.exports = app;
