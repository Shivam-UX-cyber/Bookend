import { body, param, validationResult } from 'express-validator';
import mongoose from 'mongoose';

export const handleRequestValidationErrors = (req, res, next) => {
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
 * Validates request ID param. Consistently returns 404 for malformed IDs.
 */
export const validateRequestId = (req, res, next) => {
  const { id } = req.params;
  if (!id || !mongoose.isValidObjectId(id)) {
    return res.status(404).json({
      success: false,
      message: 'Purchase request not found.',
    });
  }
  next();
};

export const validateCreatePurchaseRequest = [
  body('bookId')
    .trim()
    .notEmpty().withMessage('Book ID is required.')
    .custom((val) => {
      if (!mongoose.isValidObjectId(val)) {
        throw new Error('Valid book ID is required.');
      }
      return true;
    }),

  body('message')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Message cannot exceed 500 characters.'),

  handleRequestValidationErrors,
];

export const validateRespondPurchaseRequest = [
  body()
    .custom((_, { req }) => {
      const action = req.body.action || req.body.status;
      if (!action || typeof action !== 'string') {
        throw new Error('Action must be specified (accept or reject).');
      }
      const normalized = action.trim().toLowerCase();
      if (!['accept', 'reject', 'accepted', 'rejected'].includes(normalized)) {
        throw new Error('Action must be either "accept" or "reject".');
      }
      // Store normalized action for controller
      req.normalizedAction = normalized.startsWith('accept') ? 'accept' : 'reject';
      return true;
    }),

  handleRequestValidationErrors,
];

export const validateCancelPurchaseRequest = [
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Cancellation reason cannot exceed 500 characters.'),

  handleRequestValidationErrors,
];
