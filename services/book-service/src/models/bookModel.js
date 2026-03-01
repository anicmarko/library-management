const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true
  },
  author: {
    type: String,
    required: [true, 'Author is required'],
    trim: true
  },
  isbn: {
    type: String,
    required: [true, 'ISBN is required'],
    unique: true,
    trim: true
  },
  available: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

bookSchema.index({ available: 1 });

const Book = mongoose.model('Book', bookSchema);

module.exports = Book;
