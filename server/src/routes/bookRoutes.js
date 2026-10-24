import express from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import {
  validateCreateBook,
  validateUpdateBook,
  validateUpdateStatus,
  validateBookId,
} from '../middleware/bookValidation.js';
import {
  getBooks,
  getBookById,
  createBook,
  getMyBooks,
  updateBook,
  updateBookStatus,
  deleteBook,
} from '../controllers/bookController.js';

const router = express.Router();

/**
 * Public routes
 */
// GET /api/books - Marketplace listing with pagination, search, category/condition filter, price sorting
router.get('/', getBooks);

/**
 * Authenticated user listings route
 * CRITICAL: /mine MUST be registered before /:id to prevent route shadowing
 */
// GET /api/books/mine - Retrieve authenticated user's own listings (available and sold)
router.get('/mine', requireAuth, getMyBooks);

/**
 * Single book public route
 */
// GET /api/books/:id - Retrieve public book details
router.get('/:id', validateBookId, getBookById);

/**
 * Authenticated state-changing routes
 */
// POST /api/books - Create a new book listing
router.post('/', requireAuth, validateCreateBook, createBook);

// PATCH /api/books/:id - Update an owned listing's editable details
router.patch('/:id', requireAuth, validateBookId, validateUpdateBook, updateBook);

// PATCH /api/books/:id/status - Update an owned listing's status (available / sold)
router.patch('/:id/status', requireAuth, validateBookId, validateUpdateStatus, updateBookStatus);

// DELETE /api/books/:id - Delete an owned listing
router.delete('/:id', requireAuth, validateBookId, deleteBook);

export default router;
