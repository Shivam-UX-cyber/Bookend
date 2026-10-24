import { body, validationResult } from 'express-validator';

/**
 * Normalizes email address and handles googlemail.com alias
 * @param {string} email 
 * @returns {string} Normalized email
 */
export const normalizeGmail = (email) => {
  if (!email || typeof email !== 'string') return '';
  let normalized = email.trim().toLowerCase();
  
  if (normalized.endsWith('@googlemail.com')) {
    normalized = normalized.replace('@googlemail.com', '@gmail.com');
  }
  
  return normalized;
};

/**
 * Strict Gmail address validation:
 * - Domain must be @gmail.com (or @googlemail.com before normalization)
 * - Username must be 6 to 30 characters (excluding dots)
 * - Allowed characters: a-z, 0-9, dot
 * - Dots cannot be leading, trailing, or consecutive
 */
export const isStrictGmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const normalized = normalizeGmail(email);
  if (!normalized.endsWith('@gmail.com')) return false;

  const username = normalized.slice(0, -'@gmail.com'.length);
  if (!username) return false;

  // Allowed characters: lowercase a-z, 0-9, and dot
  if (!/^[a-z0-9.]+$/.test(username)) return false;

  // No leading dot, no trailing dot, no consecutive dots
  if (username.startsWith('.') || username.endsWith('.') || username.includes('..')) {
    return false;
  }

  // Gmail username length without dots must be strictly between 6 and 30 characters
  const cleanUsername = username.replace(/\./g, '');
  if (cleanUsername.length < 6 || cleanUsername.length > 30) {
    return false;
  }

  return true;
};

/**
 * International name validation:
 * - Supports Unicode letters and combining marks across all world languages
 * - Allows culturally appropriate spaces, hyphens, dots, and apostrophes
 * - Rejects punctuation-only or whitespace-only input
 * - Enforces 2 to 70 characters
 */
export const isValidInternationalName = (name) => {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 70) return false;

  // Must contain at least one Unicode letter
  if (!/\p{L}/u.test(trimmed)) return false;

  // Allowed characters: Unicode letters, combining marks, spaces, hyphens, dots, apostrophes
  if (!/^[\p{L}\p{M}\s.'-]+$/u.test(trimmed)) return false;

  return true;
};

export const handleValidationErrors = (req, res, next) => {
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

export const validateRegistration = [
  body('name')
    .trim()
    .notEmpty().withMessage('Full name is required.')
    .custom((value) => {
      if (!isValidInternationalName(value)) {
        throw new Error('Name must be 2-70 characters and contain valid letters (spaces, hyphens, and apostrophes allowed).');
      }
      return true;
    }),

  body('email')
    .trim()
    .notEmpty().withMessage('Gmail address is required.')
    .customSanitizer(normalizeGmail)
    .custom((value) => {
      if (!isStrictGmail(value)) {
        throw new Error('Please provide a valid personal Gmail address (username must be 6-30 characters).');
      }
      return true;
    }),

  body('password')
    .notEmpty().withMessage('Password is required.')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long.')
    .custom((value) => {
      if (Buffer.byteLength(value, 'utf8') > 72) {
        throw new Error('Password cannot exceed 72 bytes due to encryption standards.');
      }
      return true;
    })
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter.')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter.')
    .matches(/[0-9]/).withMessage('Password must contain at least one number.')
    .matches(/[!@#$%^&*(),.?":{}|<>_\-+=~`]/).withMessage('Password must contain at least one special character.'),

  body('confirmPassword')
    .notEmpty().withMessage('Please confirm your password.')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match.');
      }
      return true;
    }),

  handleValidationErrors,
];

export const validateOtpVerification = [
  body('otp')
    .trim()
    .notEmpty().withMessage('Verification code is required.')
    .isLength({ min: 6, max: 6 }).withMessage('Verification code must be exactly 6 digits.')
    .matches(/^\d{6}$/).withMessage('Verification code must contain only 6 digits.'),

  // Optional email parameter if supplied; otherwise derived from flow cookie
  body('email')
    .optional()
    .trim()
    .customSanitizer(normalizeGmail)
    .custom((value) => {
      if (value && !isStrictGmail(value)) {
        throw new Error('Valid Gmail address is required.');
      }
      return true;
    }),

  handleValidationErrors,
];

export const validateResendOtp = [
  body('email')
    .optional()
    .trim()
    .customSanitizer(normalizeGmail)
    .custom((value) => {
      if (value && !isStrictGmail(value)) {
        throw new Error('Valid Gmail address is required.');
      }
      return true;
    }),

  handleValidationErrors,
];

export const validateLogin = [
  body('email')
    .trim()
    .notEmpty().withMessage('Gmail address is required.')
    .customSanitizer(normalizeGmail)
    .custom((value) => {
      if (!isStrictGmail(value)) {
        throw new Error('Please enter a valid Gmail address.');
      }
      return true;
    }),

  body('password')
    .notEmpty().withMessage('Password is required.')
    .custom((value) => {
      if (Buffer.byteLength(value, 'utf8') > 72) {
        throw new Error('Password cannot exceed 72 bytes.');
      }
      return true;
    }),

  handleValidationErrors,
];

export const validateForgotPassword = [
  body('email')
    .trim()
    .notEmpty().withMessage('Gmail address is required.')
    .customSanitizer(normalizeGmail)
    .custom((value) => {
      if (!isStrictGmail(value)) {
        throw new Error('Please enter a valid Gmail address.');
      }
      return true;
    }),

  handleValidationErrors,
];

export const validateResetPassword = [
  body('newPassword')
    .notEmpty().withMessage('New password is required.')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long.')
    .custom((value) => {
      if (Buffer.byteLength(value, 'utf8') > 72) {
        throw new Error('Password cannot exceed 72 bytes due to encryption standards.');
      }
      return true;
    })
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter.')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter.')
    .matches(/[0-9]/).withMessage('Password must contain at least one number.')
    .matches(/[!@#$%^&*(),.?":{}|<>_\-+=~`]/).withMessage('Password must contain at least one special character.'),

  body('confirmPassword')
    .notEmpty().withMessage('Please confirm your new password.')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Passwords do not match.');
      }
      return true;
    }),

  handleValidationErrors,
];
