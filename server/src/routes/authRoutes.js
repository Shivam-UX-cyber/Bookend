import express from 'express';
import {
  register,
  getRegistrationStatus,
  verifyRegistrationOtp,
  resendRegistrationOtp,
  login,
  logout,
  getMe,
  forgotPassword,
  getForgotPasswordStatus,
  verifyResetOtp,
  resendResetOtp,
  resetPassword,
  cancelForgotPassword,
  cancelRegistration,
  diagnosticSmtp,
} from '../controllers/authController.js';
import {
  validateRegistration,
  validateOtpVerification,
  validateResendOtp,
  validateLogin,
  validateForgotPassword,
  validateResetPassword,
} from '../middleware/validationMiddleware.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { authLimiter, otpLimiter, diagnosticLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Registration Flow
router.post('/register', authLimiter, validateRegistration, register);
router.get('/registration-status', getRegistrationStatus);
router.post('/verify-registration-otp', otpLimiter, validateOtpVerification, verifyRegistrationOtp);
router.post('/resend-registration-otp', otpLimiter, validateResendOtp, resendRegistrationOtp);
router.post('/cancel-registration', cancelRegistration);

// Authentication Session Flow
router.post('/login', authLimiter, validateLogin, login);
router.post('/logout', logout);
router.get('/me', requireAuth, getMe);

// Password Reset Flow
router.post('/forgot-password', otpLimiter, validateForgotPassword, forgotPassword);
router.get('/forgot-password/status', getForgotPasswordStatus);
router.post('/verify-reset-otp', otpLimiter, validateOtpVerification, verifyResetOtp);
router.post('/resend-reset-otp', otpLimiter, validateResendOtp, resendResetOtp);
router.post('/forgot-password/cancel', cancelForgotPassword);
router.post('/reset-password', authLimiter, validateResetPassword, resetPassword);

// Protected Diagnostic Endpoint (Requires DIAGNOSTIC_KEY in server environment; disabled by default)
router.get('/diagnostic/smtp', diagnosticLimiter, diagnosticSmtp);

export default router;
