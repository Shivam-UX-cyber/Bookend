import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/env.js';

/**
 * Sign an authentication JWT with user ID and tokenVersion
 * @param {Object} user 
 * @returns {string} Signed JWT
 */
export const generateAuthToken = (user) => {
  return jwt.sign(
    {
      id: user._id.toString(),
      tokenVersion: user.tokenVersion ?? 0,
    },
    config.jwtSecret,
    {
      expiresIn: config.jwtExpiresIn,
    }
  );
};

/**
 * Verify an authentication JWT
 * @param {string} token 
 * @returns {Object} Decoded payload
 */
export const verifyAuthToken = (token) => {
  return jwt.verify(token, config.jwtSecret);
};

/**
 * Generate a cryptographically secure random reset token
 * @returns {string} 64-char hex string
 */
export const generateResetToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

export const generateFlowToken = generateResetToken;

export const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

export const hashFlowToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};
