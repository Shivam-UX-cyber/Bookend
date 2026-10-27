import { config } from '../config/env.js';

/**
 * Canonical cookie options for issuing session cookies.
 * In cross-site production (e.g. Render frontend + Render backend),
 * SameSite='None' and Secure=true are required by modern browsers.
 */
export const getCookieOptions = (maxAgeMs = 7 * 24 * 60 * 60 * 1000) => {
  const isProd = config.nodeEnv === 'production';
  const sameSite = (config.cookieSameSite || (isProd ? 'none' : 'lax')).toLowerCase();
  const secure = sameSite === 'none' ? true : (config.cookieSecure ?? isProd);

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    maxAge: maxAgeMs,
  };
};

/**
 * Canonical cookie options for clearing session cookies.
 * Per RFC 6265bis, SameSite, Secure, and Path attributes MUST match
 * the original issuance attributes for the browser to reliably delete the cookie.
 */
export const getClearCookieOptions = () => {
  const isProd = config.nodeEnv === 'production';
  const sameSite = (config.cookieSameSite || (isProd ? 'none' : 'lax')).toLowerCase();
  const secure = sameSite === 'none' ? true : (config.cookieSecure ?? isProd);

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
  };
};
