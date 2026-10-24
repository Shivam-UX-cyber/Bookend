import { body, param, validationResult } from 'express-validator';
import mongoose from 'mongoose';
import { BOOK_CATEGORIES, BOOK_CONDITIONS, BOOK_STATUSES, MANUAL_BOOK_STATUSES } from '../models/Book.js';

export const handleBookValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: errors.array()[0].msg,
      errors: errors.array().map((err) => ({
        field: err.path,
        message: err.msg,
      })),
    });
  }
  next();
};

/**
 * Validates MongoDB ObjectId param. Returns 404 if invalid format to treat malformed IDs
 * consistently as non-existent records.
 */
export const validateBookId = (req, res, next) => {
  const { id } = req.params;
  if (!id || !mongoose.isValidObjectId(id)) {
    return res.status(404).json({
      success: false,
      message: 'Book listing not found.',
    });
  }
  next();
};

const validatePriceValue = (value) => {
  if (value === undefined || value === null || value === '') {
    throw new Error('Selling price is required.');
  }

  const num = Number(value);
  if (!Number.isFinite(num) || isNaN(num)) {
    throw new Error('Selling price must be a valid number.');
  }

  if (num <= 0) {
    throw new Error('Selling price must be greater than zero.');
  }

  if (num < 1) {
    throw new Error('Minimum selling price is ₹1.');
  }

  if (num > 100000) {
    throw new Error('Selling price cannot exceed ₹1,00,000.');
  }

  // Ensure no more than 2 decimal places (paise precision)
  const parts = String(value).split('.');
  if (parts.length === 2 && parts[1].length > 2) {
    throw new Error('Selling price cannot have more than 2 decimal places.');
  }

  return true;
};

const validateOptionalIsbn = (value) => {
  if (!value || typeof value !== 'string' || value.trim() === '') {
    return true; // Optional
  }
  const clean = value.trim().replace(/[-\s]/g, '');
  if (!/^(97[89])?\d{9}[\dX]$/i.test(clean) || (clean.length !== 10 && clean.length !== 13)) {
    throw new Error('ISBN must be a valid 10 or 13-digit standard book identifier.');
  }
  return true;
};

const validateOptionalImageUrl = (value) => {
  if (!value || typeof value !== 'string' || value.trim() === '') {
    return true; // Optional
  }
  const trimmed = value.trim();
  if (trimmed.length > 500) {
    throw new Error('Image URL cannot exceed 500 characters.');
  }
  if (!/^https?:\/\/.+/i.test(trimmed)) {
    throw new Error('Image URL must start with http:// or https://');
  }
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Image URL must use HTTP or HTTPS protocol.');
    }
  } catch {
    throw new Error('Please provide a valid web URL for the book cover image.');
  }
  return true;
};

export const validateCreateBook = [
  body('title')
    .trim()
    .notEmpty().withMessage('Book title is required.')
    .isLength({ min: 2, max: 150 }).withMessage('Title must be between 2 and 150 characters.'),

  body('author')
    .trim()
    .notEmpty().withMessage('Author name is required.')
    .isLength({ min: 2, max: 100 }).withMessage('Author name must be between 2 and 100 characters.'),

  body('description')
    .trim()
    .notEmpty().withMessage('Description is required.')
    .isLength({ min: 10, max: 2000 }).withMessage('Description must be between 10 and 2000 characters.'),

  body('category')
    .trim()
    .notEmpty().withMessage('Category / subject is required.')
    .isIn(BOOK_CATEGORIES).withMessage('Please select a valid academic category.'),

  body('condition')
    .trim()
    .notEmpty().withMessage('Book condition is required.')
    .isIn(BOOK_CONDITIONS).withMessage('Please select a valid condition (New, Like New, Good, Acceptable).'),

  body('price')
    .custom(validatePriceValue),

  body('isbn')
    .optional({ checkFalsy: true })
    .custom(validateOptionalIsbn),

  body('imageUrl')
    .optional({ checkFalsy: true })
    .custom(validateOptionalImageUrl),

  handleBookValidationErrors,
];

export const validateUpdateBook = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 2, max: 150 }).withMessage('Title must be between 2 and 150 characters.'),

  body('author')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 }).withMessage('Author name must be between 2 and 100 characters.'),

  body('description')
    .optional()
    .trim()
    .isLength({ min: 10, max: 2000 }).withMessage('Description must be between 10 and 2000 characters.'),

  body('category')
    .optional()
    .trim()
    .isIn(BOOK_CATEGORIES).withMessage('Please select a valid academic category.'),

  body('condition')
    .optional()
    .trim()
    .isIn(BOOK_CONDITIONS).withMessage('Please select a valid condition (New, Like New, Good, Acceptable).'),

  body('price')
    .optional()
    .custom(validatePriceValue),

  body('isbn')
    .optional({ checkFalsy: true })
    .custom(validateOptionalIsbn),

  body('imageUrl')
    .optional({ checkFalsy: true })
    .custom(validateOptionalImageUrl),

  // Ensure at least one valid editable field is provided in the update payload
  (req, res, next) => {
    const allowedFields = ['title', 'author', 'description', 'category', 'condition', 'price', 'imageUrl', 'isbn'];
    const hasAtLeastOneField = allowedFields.some((field) => req.body[field] !== undefined);
    if (!hasAtLeastOneField) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one valid field to update.',
      });
    }
    next();
  },

  handleBookValidationErrors,
];

export const validateUpdateStatus = [
  body('status')
    .trim()
    .notEmpty().withMessage('Status is required.')
    .isIn(MANUAL_BOOK_STATUSES).withMessage('Status must be either "available" or "sold".'),

  handleBookValidationErrors,
];
