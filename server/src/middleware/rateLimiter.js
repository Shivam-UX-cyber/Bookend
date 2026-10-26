import rateLimit from 'express-rate-limit';

/**
 * General API Limiter (applies to all endpoints)
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 300 : 3000, // Generous headroom for dev/testing
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    xForwardedForHeader: false,
  },
  skip: (req) => {
    if (req.headers['x-test-rate-limit'] === 'true') return false;
    return (
      process.env.NODE_ENV === 'test' ||
      req.path === '/health' ||
      req.path === '/notifications/stream'
    );
  },
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
  },
});

/**
 * Strict limiter for sensitive authentication actions (login, register)
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 30 : 120, // 30 in prod, 120 in dev
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    xForwardedForHeader: false,
  },
  skip: (req) => {
    if (req.headers['x-test-rate-limit'] === 'true') return false;
    return process.env.NODE_ENV === 'test';
  },
  message: {
    success: false,
    message: 'Too many authentication attempts from this IP. Please try again after 15 minutes.',
  },
});

/**
 * Dedicated limiter for OTP generation/resend requests
 */
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 25 : 120, // 25 in prod (accommodates shared campus NAT), 120 in dev
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    xForwardedForHeader: false,
  },
  skip: (req) => {
    if (req.headers['x-test-rate-limit'] === 'true') return false;
    return process.env.NODE_ENV === 'test';
  },
  message: {
    success: false,
    message: 'Too many OTP requests from this IP. Please try again after 15 minutes.',
  },
});

/**
 * Strict limiter for protected diagnostic endpoints
 */
export const diagnosticLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // maximum 10 diagnostic requests per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    xForwardedForHeader: false,
  },
  skip: (req) => {
    if (req.headers['x-test-rate-limit'] === 'true') return false;
    return process.env.NODE_ENV === 'test';
  },
  message: {
    success: false,
    message: 'Too many diagnostic requests from this IP. Please try again after 15 minutes.',
  },
});
