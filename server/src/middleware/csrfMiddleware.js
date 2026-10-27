import { config } from '../config/env.js';

/**
 * CSRF Protection Middleware
 * 
 * Protects cookie-authenticated and state-changing requests by:
 * 1. Validating that Origin/Referer headers match allowed frontend origins for POST/PUT/PATCH/DELETE requests.
 * 2. Requiring an explicit custom header (X-Requested-With: XMLHttpRequest or X-CSRF-Protection)
 *    on state-changing browser requests in production (or when testing CSRF enforcement),
 *    which browser cross-origin forms and simple scripts cannot set without CORS preflight permission.
 */
export const csrfProtection = (allowedOrigins) => {
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  const normalizedAllowed = (allowedOrigins || []).map((o) => o.trim().replace(/\/+$/, ''));

  return (req, res, next) => {
    // Safe idempotent methods do not mutate state
    if (safeMethods.has(req.method)) {
      return next();
    }

    // In test environment without origins provided, permit local supertest unless explicitly testing CSRF
    const isExplicitCsrfTest = req.headers['x-test-csrf'] === 'true';
    if (config.nodeEnv === 'test' && !req.headers.origin && !req.headers.referer && !isExplicitCsrfTest) {
      return next();
    }

    const origin = req.headers.origin;
    const referer = req.headers.referer;

    // 1. Check Origin header if present
    if (origin) {
      const cleanOrigin = origin.trim().replace(/\/+$/, '');
      const isAllowedOrigin = normalizedAllowed.includes(cleanOrigin);
      if (!isAllowedOrigin) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: Request origin is not authorized (CSRF protection).',
        });
      }
    } else if (referer) {
      // Check Referer header if Origin header was omitted
      try {
        const refererOrigin = new URL(referer).origin.replace(/\/+$/, '');
        const isAllowedReferer = normalizedAllowed.includes(refererOrigin);
        if (!isAllowedReferer) {
          return res.status(403).json({
            success: false,
            message: 'Access denied: Request referer is not authorized (CSRF protection).',
          });
        }
      } catch (err) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: Invalid referer header (CSRF protection).',
        });
      }
    } else if (config.nodeEnv === 'production' || isExplicitCsrfTest) {
      // In production (or explicit CSRF test), require Origin or Referer for state-changing requests
      return res.status(403).json({
        success: false,
        message: 'Access denied: Missing origin header for state-changing request (CSRF protection).',
      });
    }

    // 2. Custom-header verification (X-Requested-With or X-CSRF-Protection)
    // Enforced in production or when explicitly testing CSRF boundaries
    if (config.nodeEnv === 'production' || isExplicitCsrfTest) {
      const xRequestedWith = req.headers['x-requested-with'];
      const xCsrfProtection = req.headers['x-csrf-protection'];
      const hasValidCustomHeader =
        (typeof xRequestedWith === 'string' && xRequestedWith.toLowerCase() === 'xmlhttprequest') ||
        (typeof xCsrfProtection === 'string' && xCsrfProtection === '1');

      if (!hasValidCustomHeader) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: Missing or invalid custom CSRF header (X-Requested-With).',
        });
      }
    }

    next();
  };
};
