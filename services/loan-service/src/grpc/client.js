'use strict';

const path = require('node:path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const logger = require('../utils/logger');

const PROTO_PATH =
  process.env.GRPC_PROTO_PATH;

const BOOK_SERVICE_GRPC_URL =
  process.env.BOOK_SERVICE_GRPC_URL;

let _client = null;

function getClient() {
  if (_client) return _client;
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const { books: booksProto } = grpc.loadPackageDefinition(packageDefinition);
  _client = new booksProto.BookService(
    BOOK_SERVICE_GRPC_URL,
    grpc.credentials.createInsecure()
  );
  return _client;
}


async function checkBookAvailability(bookId) {
  return new Promise((resolve) => {
    const deadline = new Date();
    deadline.setMilliseconds(deadline.getMilliseconds() + 3000);

    getClient().CheckAvailability({ id: String(bookId) }, { deadline }, (error, response) => {
      if (error) {
        logger.warn('gRPC CheckAvailability failed — allowing loan creation (graceful degradation)', {
          bookId,
          grpcCode: error.code,
          error: error.message,
        });
        resolve({ available: true, found: true, message: 'gRPC unavailable — proceeding' });
        return;
      }

      resolve({
        available: response.available,
        found: response.found,
        message: response.message,
      });
    });
  });
}

module.exports = { checkBookAvailability };
