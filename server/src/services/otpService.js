import crypto from 'crypto';
import bcrypt from 'bcryptjs';

/**
 * Generate a cryptographically strong 6-digit numeric OTP
 * @returns {string} 6-digit numeric string
 */
export const generateOtp = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

/**
 * Hash an OTP using bcrypt
 * @param {string} otp 
 * @returns {Promise<string>}
 */
export const hashOtp = async (otp) => {
  return bcrypt.hash(otp, 10);
};

/**
 * Verify a plain OTP against a stored bcrypt hash
 * @param {string} plainOtp 
 * @param {string} hashedOtp 
 * @returns {Promise<boolean>}
 */
export const compareOtp = async (plainOtp, hashedOtp) => {
  return bcrypt.compare(plainOtp, hashedOtp);
};
