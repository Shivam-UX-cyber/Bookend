import { param, query, validationResult } from 'express-validator';
import mongoose from 'mongoose';

export const handleNotificationValidationErrors = (req, res, next) => {
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
 * Validates notification ID param. Returns 404 consistently for malformed IDs.
 */
export const validateNotificationId = (req, res, next) => {
  const { id } = req.params;
  if (!id || !mongoose.isValidObjectId(id)) {
    return res.status(404).json({
      success: false,
      message: 'Notification not found.',
    });
  }
  next();
};

export const validateGetNotifications = [
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page must be a positive integer.'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 }).withMessage('Limit must be an integer between 1 and 50.'),

  query('isRead')
    .optional()
    .isIn(['true', 'false', '1', '0']).withMessage('isRead must be a boolean value.'),

  handleNotificationValidationErrors,
];
