'use strict';

const path = require('node:path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const logger = require('../utils/logger');
const Book = require('../models/bookModel');

const PROTO_PATH =
  process.env.GRPC_PROTO_PATH;

const GRPC_PORT = process.env.GRPC_PORT || 50051;

async function getBook(call, callback) {
  const { id } = call.request;
  logger.info('gRPC GetBook called', { bookId: id });

  try {
    const book = await Book.findById(id);

    if (!book) {
      return callback(null, {
        id: '',
        title: '',
        author: '',
        available: false,
        found: false,
      });
    }

    callback(null, {
      id: book._id.toString(),
      title: book.title,
      author: book.author,
      available: book.available,
      found: true,
    });
  } catch (error) {
    logger.error('gRPC GetBook error', { error: error.message, bookId: id });
    callback({ code: grpc.status.INTERNAL, message: 'Internal server error' });
  }
}

async function checkAvailability(call, callback) {
  const { id } = call.request;
  logger.info('gRPC CheckAvailability called', { bookId: id });

  try {
    const book = await Book.findById(id);

    if (!book) {
      return callback(null, {
        available: false,
        found: false,
        message: 'Book not found',
      });
    }

    callback(null, {
      available: book.available,
      found: true,
      message: book.available ? 'Book is available' : 'Book is not available',
    });
  } catch (error) {
    logger.error('gRPC CheckAvailability error', { error: error.message, bookId: id });
    callback({ code: grpc.status.INTERNAL, message: 'Internal server error' });
  }
}

function startGrpcServer() {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const { books: booksProto } = grpc.loadPackageDefinition(packageDefinition);

  const server = new grpc.Server();

  server.addService(booksProto.BookService.service, {
    GetBook: getBook,
    CheckAvailability: checkAvailability,
  });

  const address = `0.0.0.0:${GRPC_PORT}`;

  server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (error, port) => {
    if (error) {
      logger.error('Failed to start gRPC server', { error: error.message });
      return;
    }
    logger.info(`gRPC server listening on port ${port}`);
  });

  return server;
}

module.exports = { startGrpcServer };
