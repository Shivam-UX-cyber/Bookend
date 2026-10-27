import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { User } from '../models/User.js';
import { PendingRegistration } from '../models/PendingRegistration.js';
import { PasswordReset } from '../models/PasswordReset.js';
import { generateOtp, hashOtp, compareOtp } from '../services/otpService.js';
import {
  generateAuthToken,
  generateResetToken,
  generateFlowToken,
  hashToken,
  hashFlowToken,
  verifyAuthToken,
} from '../services/tokenService.js';
import {
  sendRegistrationOtpEmail,
  sendPasswordResetOtpEmail,
  logSafeMailError,
  verifyEmailConnection,
  verifySmtpConnection,
  isEmailConfigured,
} from '../services/mailService.js';
import { config } from '../config/env.js';

const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const FLOW_SESSION_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const RESET_AUTH_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_ATTEMPTS = 5;

// Pre-computed hash used for constant-time comparisons when a user is not found (anti-enumeration)
const DUMMY_HASH = '$2a$12$e80MvQhXb/fG5NqN6U7e3.bB6O9rVvMvF5R2nU7J9n4N2P3O4Q5R6';

// Canonical cookie settings imported from cookieHelper utility
export { getCookieOptions, getClearCookieOptions } from '../utils/cookieHelper.js';
import { getCookieOptions, getClearCookieOptions } from '../utils/cookieHelper.js';

/**
 * Helpers to safely sign/read flow session cookies
 */
const setFlowCookie = (res, name, data, maxAgeMs = FLOW_SESSION_EXPIRY_MS) => {
  const jsonStr = JSON.stringify(data);
  const encoded = Buffer.from(jsonStr).toString('base64');
  res.cookie(name, encoded, getCookieOptions(maxAgeMs));
};

const getFlowCookie = (req, name) => {
  const cookieVal = req.cookies?.[name];
  if (!cookieVal) return null;
  try {
    const jsonStr = Buffer.from(cookieVal, 'base64').toString('utf8');
    return JSON.parse(jsonStr);
  } catch (err) {
    return null;
  }
};

/**
 * 1. Register User (Step 1: Validate, hash password, create pending registration, bind flow, send OTP)
 */
export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if active user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'An account with this Gmail address already exists. Please log in.',
      });
    }

    // Check if pending registration is currently within resend cooldown (only if not expired)
    const existingPending = await PendingRegistration.findOne({ email });
    const now = Date.now();
    if (existingPending && now < existingPending.expiresAt.getTime() && now < existingPending.resendAvailableAt.getTime()) {
      const waitSeconds = Math.ceil((existingPending.resendAvailableAt.getTime() - now) / 1000);
      return res.status(429).json({
        success: false,
        message: `A verification code was recently sent. Please wait ${waitSeconds} seconds before retrying.`,
        retryAfter: waitSeconds,
      });
    }

    // Hash password with bcrypt (work factor 12)
    const hashedPassword = await bcrypt.hash(password, 12);

    // Generate 6-digit OTP and hash it with bcrypt
    const otp = generateOtp();
    const hashedOtp = await hashOtp(otp);

    // Generate opaque cryptographic flow token
    const flowToken = generateFlowToken();
    const flowTokenHash = hashFlowToken(flowToken);

    const otpExpiresAt = new Date(now + OTP_EXPIRY_MS);
    const resendAvailableAt = new Date(now + RESEND_COOLDOWN_MS);
    const expiresAt = new Date(now + FLOW_SESSION_EXPIRY_MS);

    // Atomic write to database with versioning and pending_delivery status
    await PendingRegistration.findOneAndUpdate(
      { email },
      {
        name,
        email,
        password: hashedPassword,
        flowTokenHash,
        otpHash: hashedOtp,
        otpVersion: 1,
        status: 'pending_delivery',
        otpExpiresAt,
        resendAvailableAt,
        attempts: 0,
        expiresAt,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Dispatch verification email
    try {
      await sendRegistrationOtpEmail(email, name, otp);
      // Mark as active upon confirmed transport
      await PendingRegistration.updateOne(
        { email, otpVersion: 1, flowTokenHash },
        { $set: { status: 'active' } }
      );
    } catch (mailError) {
      logSafeMailError('register', mailError, email);
      // Safe concurrency check: only roll back if a newer OTP has NOT been issued concurrently!
      await PendingRegistration.deleteOne({ email, otpVersion: 1, flowTokenHash });
      res.clearCookie('regSession', getClearCookieOptions());
      return res.status(503).json({
        success: false,
        message: 'Failed to dispatch verification email. Please check server email configuration or try again.',
      });
    }

    // Set short-lived HTTP-only flow cookie binding the client to this registration session
    setFlowCookie(res, 'regSession', { flowToken });

    return res.status(200).json({
      success: true,
      message: 'A 6-digit verification code has been sent to your Gmail address.',
      cooldownSeconds: 60,
    });
  } catch (error) {
    console.error('[Register Error]', error);
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred during registration. Please try again.',
    });
  }
};

/**
 * 2. Get Registration Status (Retrieves cooldown & flow state exclusively via secure flow session)
 */
export const getRegistrationStatus = async (req, res) => {
  try {
    const flow = getFlowCookie(req, 'regSession');
    if (!flow || !flow.flowToken) {
      return res.status(200).json({
        success: true,
        active: false,
        cooldownSeconds: 0,
      });
    }

    const flowTokenHash = hashFlowToken(flow.flowToken);
    const pending = await PendingRegistration.findOne({
      flowTokenHash,
      expiresAt: { $gt: new Date() },
    });

    if (!pending) {
      res.clearCookie('regSession', getClearCookieOptions());
      return res.status(200).json({
        success: true,
        active: false,
        cooldownSeconds: 0,
      });
    }

    const now = Date.now();
    const remainingCooldown = Math.max(0, Math.ceil((pending.resendAvailableAt.getTime() - now) / 1000));
    const isExpired = now > pending.otpExpiresAt.getTime();

    return res.status(200).json({
      success: true,
      active: true,
      email: pending.email,
      cooldownSeconds: remainingCooldown,
      isExpired,
    });
  } catch (error) {
    console.error('[Registration Status Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve registration status.',
    });
  }
};

/**
 * 3. Verify Registration OTP (Atomically verifies OTP bound to the flow session)
 */
export const verifyRegistrationOtp = async (req, res) => {
  try {
    const { otp } = req.body;
    const flow = getFlowCookie(req, 'regSession');

    if (!flow || !flow.flowToken) {
      return res.status(400).json({
        success: false,
        message: 'Registration session has expired or is invalid. Please register again.',
      });
    }

    const flowTokenHash = hashFlowToken(flow.flowToken);
    const now = new Date();

    // Verify record exists and flow is not expired
    const checkDoc = await PendingRegistration.findOne({ flowTokenHash });
    if (!checkDoc || now.getTime() > checkDoc.expiresAt.getTime()) {
      res.clearCookie('regSession', getClearCookieOptions());
      return res.status(400).json({
        success: false,
        message: 'Registration session has expired or is invalid. Please register again.',
        isExpired: true,
      });
    }

    if (checkDoc.status === 'delivery_failed') {
      return res.status(400).json({
        success: false,
        message: 'Email delivery encountered an issue. Please click resend to receive a new code.',
      });
    }

    // 1. Atomic attempt tracking: increment attempts atomically up to MAX_OTP_ATTEMPTS
    const pending = await PendingRegistration.findOneAndUpdate(
      {
        flowTokenHash,
        status: 'active',
        attempts: { $lt: MAX_OTP_ATTEMPTS },
        otpExpiresAt: { $gt: now },
        expiresAt: { $gt: now },
      },
      {
        $inc: { attempts: 1 },
      },
      { new: true }
    );

    if (!pending) {
      if (now.getTime() > checkDoc.otpExpiresAt.getTime()) {
        return res.status(400).json({
          success: false,
          message: 'Verification code has expired. Please request a new code.',
          isExpired: true,
        });
      }

      // Attempts exceeded limit
      await PendingRegistration.deleteOne({ _id: checkDoc._id });
      res.clearCookie('regSession', getClearCookieOptions());
      return res.status(400).json({
        success: false,
        message: 'Maximum verification attempts exceeded. Your registration session has been cleared. Please register again.',
      });
    }

    // 2. Compare OTP
    const isMatch = await compareOtp(otp, pending.otpHash);
    if (!isMatch) {
      const remaining = MAX_OTP_ATTEMPTS - pending.attempts;
      if (remaining <= 0) {
        await PendingRegistration.deleteOne({ _id: pending._id });
        res.clearCookie('regSession', getClearCookieOptions());
        return res.status(400).json({
          success: false,
          message: 'Maximum verification attempts exceeded. Your registration session has been cleared. Please register again.',
        });
      }
      return res.status(400).json({
        success: false,
        message: `Invalid verification code. You have ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} remaining.`,
      });
    }

    // 3. Atomically consume the pending registration to prevent concurrent double-activation
    const consumedPending = await PendingRegistration.findOneAndDelete({ _id: pending._id });
    if (!consumedPending) {
      return res.status(409).json({
        success: false,
        message: 'Registration was already processed concurrently.',
      });
    }

    // 4. Check if user already exists
    const existingUser = await User.findOne({ email: consumedPending.email });
    if (existingUser) {
      res.clearCookie('regSession', getClearCookieOptions());
      return res.status(409).json({
        success: false,
        message: 'An account with this Gmail address is already active. Please log in.',
      });
    }

    // 5. Create active verified user
    const newUser = new User({
      name: consumedPending.name,
      email: consumedPending.email,
      password: consumedPending.password,
      isVerified: true,
      tokenVersion: 0,
    });

    try {
      await newUser.save();
    } catch (saveError) {
      if (saveError.code === 11000) {
        res.clearCookie('regSession', getClearCookieOptions());
        return res.status(409).json({
          success: false,
          message: 'An account with this Gmail address is already active. Please log in.',
        });
      }

      // Safe compensation: restore consumed pending record so registration data is not lost on DB failure
      await PendingRegistration.create({
        name: consumedPending.name,
        email: consumedPending.email,
        password: consumedPending.password,
        flowTokenHash: consumedPending.flowTokenHash,
        otpHash: consumedPending.otpHash,
        otpVersion: consumedPending.otpVersion,
        status: consumedPending.status,
        otpExpiresAt: consumedPending.otpExpiresAt,
        resendAvailableAt: consumedPending.resendAvailableAt,
        attempts: consumedPending.attempts,
        expiresAt: consumedPending.expiresAt,
      }).catch((e) => console.error('[Failed to restore pending registration]', e));

      throw saveError;
    }

    res.clearCookie('regSession', getClearCookieOptions());

    return res.status(201).json({
      success: true,
      message: 'Account verified successfully! You can now log in with your credentials.',
    });
  } catch (error) {
    console.error('[Verify Registration OTP Error]', error);
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred during email verification.',
    });
  }
};

/**
 * 4. Resend Registration OTP (With atomic cooldown enforcement and flow token verification)
 */
export const resendRegistrationOtp = async (req, res) => {
  try {
    const flow = getFlowCookie(req, 'regSession');

    if (!flow || !flow.flowToken) {
      return res.status(400).json({
        success: false,
        message: 'Registration session has expired. Please register again.',
      });
    }

    const flowTokenHash = hashFlowToken(flow.flowToken);
    const now = new Date();

    // Check if flow exists and is not expired before attempting resend
    const existing = await PendingRegistration.findOne({ flowTokenHash });
    if (!existing || now.getTime() >= existing.expiresAt.getTime()) {
      res.clearCookie('regSession', getClearCookieOptions());
      return res.status(400).json({
        success: false,
        message: 'Registration session has expired. Please register again.',
        isExpired: true,
      });
    }

    if (now < existing.resendAvailableAt) {
      const waitSeconds = Math.max(1, Math.ceil((existing.resendAvailableAt.getTime() - now.getTime()) / 1000));
      return res.status(429).json({
        success: false,
        message: `Please wait ${waitSeconds} seconds before requesting another verification code.`,
        retryAfter: waitSeconds,
      });
    }

    const newOtp = generateOtp();
    const newHashedOtp = await hashOtp(newOtp);

    // Atomic conditional update enforcing resendAvailableAt <= now and non-expired flow
    const updated = await PendingRegistration.findOneAndUpdate(
      {
        flowTokenHash,
        resendAvailableAt: { $lte: now },
        expiresAt: { $gt: now },
      },
      {
        $set: {
          otpHash: newHashedOtp,
          status: 'pending_delivery',
          otpExpiresAt: new Date(now.getTime() + OTP_EXPIRY_MS),
          resendAvailableAt: new Date(now.getTime() + RESEND_COOLDOWN_MS),
          attempts: 0,
          expiresAt: new Date(now.getTime() + FLOW_SESSION_EXPIRY_MS),
        },
        $inc: { otpVersion: 1 },
      },
      { new: true }
    );

    if (!updated) {
      return res.status(400).json({
        success: false,
        message: 'Registration session has expired or is invalid. Please register again.',
      });
    }

    const currentVersion = updated.otpVersion;

    try {
      await sendRegistrationOtpEmail(updated.email, updated.name, newOtp);
      // Mark as active upon delivery
      await PendingRegistration.updateOne(
        { flowTokenHash, otpVersion: currentVersion },
        { $set: { status: 'active' } }
      );
    } catch (mailError) {
      logSafeMailError('resendRegistrationOtp', mailError, updated.email);
      // Concurrency safe rollback: only revert if otpVersion hasn't changed
      await PendingRegistration.updateOne(
        { flowTokenHash, otpVersion: currentVersion },
        {
          $set: {
            status: 'delivery_failed',
            resendAvailableAt: new Date(), // Allow immediate retry on transport failure
          },
        }
      );
      return res.status(503).json({
        success: false,
        message: 'Failed to send verification email. Please try again.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'A new 6-digit verification code has been dispatched to your Gmail.',
      cooldownSeconds: 60,
    });
  } catch (error) {
    console.error('[Resend Registration OTP Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to resend verification code.',
    });
  }
};

/**
 * 5. Login User (Validates credentials, verifies email activation gate, sets HTTP-only JWT cookie)
 */
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');

    // Anti-enumeration: If user does not exist, run a dummy bcrypt compare to equalize response time
    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({
        success: false,
        message: 'Invalid email address or password.',
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email address or password.',
      });
    }

    // Strict Gate: Account MUST be verified via OTP
    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Your email address has not been verified. Please complete verification before logging in.',
        isUnverified: true,
        email: user.email,
      });
    }

    // Generate JWT token containing user id and tokenVersion
    const token = generateAuthToken(user);

    // Set secure HTTP-only cookie
    res.cookie('authToken', token, getCookieOptions());

    return res.status(200).json({
      success: true,
      message: 'Logged in successfully.',
      user: {
        id: user._id,
        name: user.name,
        displayName: user.displayName || '',
        avatarUrl: user.avatarUrl || '',
        email: user.email,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('[Login Error]', error);
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred during login. Please try again.',
    });
  }
};

/**
 * 6. Logout User (Clears cookie and performs real tokenVersion invalidation in database)
 */
export const logout = async (req, res) => {
  const token = req.cookies?.authToken;

  // Always clear the cookie
  res.clearCookie('authToken', getClearCookieOptions());

  if (!token) {
    return res.status(200).json({
      success: true,
      message: 'Logged out successfully. No active session token found.',
      invalidatedAllSessions: false,
    });
  }

  let decoded;
  try {
    decoded = verifyAuthToken(token);
  } catch (tokenErr) {
    return res.status(200).json({
      success: true,
      message: 'Logged out successfully. Session token was already expired or invalid.',
      invalidatedAllSessions: false,
    });
  }

  try {
    const updatedUser = await User.findByIdAndUpdate(
      decoded.id,
      { $inc: { tokenVersion: 1 } },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(200).json({
        success: true,
        message: 'Logged out successfully. User account was not found in database.',
        invalidatedAllSessions: false,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully. All active sessions have been invalidated.',
      invalidatedAllSessions: true,
    });
  } catch (dbError) {
    console.error('[Logout Database Error]', dbError);
    return res.status(500).json({
      success: false,
      message: 'Logout encountered an internal database error. Client session cookie was cleared, but global session revocation could not be confirmed.',
      invalidatedAllSessions: false,
    });
  }
};

/**
 * 7. Get Current Authenticated User (Protected)
 */
export const getMe = (req, res) => {
  return res.status(200).json({
    success: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      displayName: req.user.displayName || '',
      avatarUrl: req.user.avatarUrl || '',
      email: req.user.email,
      createdAt: req.user.createdAt,
    },
  });
};

/**
 * 8. Forgot Password (Initiate: send reset OTP with anti-enumeration protection and flow token binding)
 */
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const now = Date.now();

    const user = await User.findOne({ email });
    const existingReset = await PasswordReset.findOne({ email });
    const isExistingExpired = existingReset && now >= existingReset.expiresAt.getTime();

    // Enforce cooldown consistently for both registered and unregistered accounts (only if not expired)
    if (existingReset && !isExistingExpired && now < existingReset.resendAvailableAt.getTime()) {
      const remainingCooldown = Math.max(1, Math.ceil((existingReset.resendAvailableAt.getTime() - now) / 1000));

      const existingFlow = getFlowCookie(req, 'resetSession');
      const clientOwnsRecord =
        existingFlow?.flowToken &&
        hashFlowToken(existingFlow.flowToken) === existingReset.flowTokenHash;

      // SECURITY: Never rebind a verified (and unexpired) reset authorization to a different client.
      // A request that does not hold the original matching flow token must receive the generic
      // anti-enumeration response without any DB write or new cookie being issued.
      if (!clientOwnsRecord && existingReset.status === 'verified') {
        const resetAuthStillValid =
          existingReset.resetTokenExpiresAt &&
          now < existingReset.resetTokenExpiresAt.getTime();

        if (resetAuthStillValid) {
          // Legitimate client is mid-flow; do not disturb the record or reveal its state.
          if (!user) {
            await bcrypt.compare('dummyPassword123', DUMMY_HASH);
          }
          return res.status(200).json({
            success: true,
            message: 'If an account exists with this Gmail address, a 6-digit password reset code has been sent.',
            cooldownSeconds: remainingCooldown,
          });
        }
        // Verified authorization has expired — fall through to issue a fresh OTP below.
      } else {
        // If client already holds the valid matching flow token, preserve it; otherwise bind a new flow token
        let flowTokenToUse;

        if (clientOwnsRecord) {
          flowTokenToUse = existingFlow.flowToken;
        } else {
          flowTokenToUse = generateFlowToken();
          const newHash = hashFlowToken(flowTokenToUse);
          await PasswordReset.updateOne(
            { email },
            {
              $set: {
                flowTokenHash: newHash,
                expiresAt: new Date(now + FLOW_SESSION_EXPIRY_MS),
              },
            }
          );
        }

        setFlowCookie(res, 'resetSession', { flowToken: flowTokenToUse });

        if (!user) {
          await bcrypt.compare('dummyPassword123', DUMMY_HASH);
        }

        return res.status(200).json({
          success: true,
          message: 'If an account exists with this Gmail address, a 6-digit password reset code has been sent.',
          cooldownSeconds: remainingCooldown,
        });
      }
    }

    // Cooldown is not active: issue new OTP
    const flowToken = generateFlowToken();
    const flowTokenHash = hashFlowToken(flowToken);
    setFlowCookie(res, 'resetSession', { flowToken });

    if (!user) {
      await bcrypt.compare('dummyPassword123', DUMMY_HASH);

      await PasswordReset.findOneAndUpdate(
        { email },
        {
          email,
          flowTokenHash,
          isAnonymous: true,
          otpHash: DUMMY_HASH,
          otpVersion: 1,
          status: 'active',
          otpExpiresAt: new Date(now + OTP_EXPIRY_MS),
          resendAvailableAt: new Date(now + RESEND_COOLDOWN_MS),
          attempts: 0,
          resetTokenHash: null,
          resetTokenExpiresAt: null,
          expiresAt: new Date(now + FLOW_SESSION_EXPIRY_MS),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      return res.status(200).json({
        success: true,
        message: 'If an account exists with this Gmail address, a 6-digit password reset code has been sent.',
        cooldownSeconds: 60,
      });
    }

    const otp = generateOtp();
    const hashedOtp = await hashOtp(otp);

    await PasswordReset.findOneAndUpdate(
      { email },
      {
        email,
        flowTokenHash,
        isAnonymous: false,
        otpHash: hashedOtp,
        otpVersion: 1,
        status: 'pending_delivery',
        otpExpiresAt: new Date(now + OTP_EXPIRY_MS),
        resendAvailableAt: new Date(now + RESEND_COOLDOWN_MS),
        attempts: 0,
        resetTokenHash: null,
        resetTokenExpiresAt: null,
        expiresAt: new Date(now + FLOW_SESSION_EXPIRY_MS),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    try {
      await sendPasswordResetOtpEmail(email, otp);
      await PasswordReset.updateOne(
        { email, flowTokenHash, otpVersion: 1 },
        { $set: { status: 'active' } }
      );
    } catch (mailError) {
      logSafeMailError('forgotPassword', mailError, email);
      // Do NOT delete the record: keep delivery_failed state and reset cooldown so student can retry resending immediately
      await PasswordReset.updateOne(
        { email, flowTokenHash, otpVersion: 1 },
        {
          $set: {
            status: 'delivery_failed',
            resendAvailableAt: new Date(now),
          },
        }
      );
      return res.status(200).json({
        success: false,
        message: 'Failed to dispatch reset email. Please try again.',
        cooldownSeconds: 0,
        deliveryFailed: true,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'If an account exists with this Gmail address, a 6-digit password reset code has been sent.',
      cooldownSeconds: 60,
    });
  } catch (error) {
    console.error('[Forgot Password Error]', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while processing your password reset request.',
    });
  }
};

/**
 * 9. Get Forgot Password Flow Status (Identical behavior for all accounts, binds to flow cookie)
 */
export const getForgotPasswordStatus = async (req, res) => {
  try {
    const flow = getFlowCookie(req, 'resetSession');
    if (!flow || !flow.flowToken) {
      return res.status(200).json({
        success: true,
        active: false,
        step: 1,
        cooldownSeconds: 0,
      });
    }

    const flowTokenHash = hashFlowToken(flow.flowToken);
    const resetRecord = await PasswordReset.findOne({
      flowTokenHash,
      expiresAt: { $gt: new Date() },
    });

    if (!resetRecord) {
      res.clearCookie('resetSession', getClearCookieOptions());
      return res.status(200).json({
        success: true,
        active: false,
        step: 1,
        cooldownSeconds: 0,
      });
    }

    const now = Date.now();

    // Step 3: Verified OTP, waiting for new password
    if (resetRecord.status === 'verified') {
      if (
        resetRecord.resetTokenExpiresAt &&
        now < resetRecord.resetTokenExpiresAt.getTime()
      ) {
        return res.status(200).json({
          success: true,
          active: true,
          email: resetRecord.email,
          step: 3,
          cooldownSeconds: 0,
        });
      }

      res.clearCookie('resetSession', getClearCookieOptions());
      return res.status(200).json({
        success: true,
        active: false,
        step: 1,
        message: 'Password reset session has expired. Please restart the request.',
      });
    }

    // Step 2: Waiting for OTP verification
    const cooldownSeconds = Math.max(0, Math.ceil((resetRecord.resendAvailableAt.getTime() - now) / 1000));
    const isExpired = now > resetRecord.otpExpiresAt.getTime();
    const isDeliveryFailed = resetRecord.status === 'delivery_failed';

    return res.status(200).json({
      success: true,
      active: true,
      email: resetRecord.email,
      step: 2,
      cooldownSeconds: isDeliveryFailed ? 0 : cooldownSeconds,
      isExpired,
      deliveryFailed: isDeliveryFailed,
      message: isDeliveryFailed ? 'We were unable to deliver the reset code email. Please click Resend to retry.' : undefined,
    });
  } catch (error) {
    console.error('[Forgot Password Status Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve password reset status.',
    });
  }
};

/**
 * 10. Verify Password Reset OTP (Opaque verification, protects verified authorization from stale attempts)
 */
export const verifyResetOtp = async (req, res) => {
  try {
    const { otp } = req.body;
    const flow = getFlowCookie(req, 'resetSession');

    if (!flow || !flow.flowToken) {
      return res.status(400).json({
        success: false,
        message: 'Password recovery session has expired or is invalid. Please request a new code.',
      });
    }

    const flowTokenHash = hashFlowToken(flow.flowToken);
    const now = new Date();

    const checkDoc = await PasswordReset.findOne({ flowTokenHash });
    if (!checkDoc || now.getTime() > checkDoc.expiresAt.getTime()) {
      res.clearCookie('resetSession', getClearCookieOptions());
      return res.status(400).json({
        success: false,
        message: 'Password recovery session has expired or is invalid. Please request a new code.',
      });
    }

    // Protected: If already verified, do NOT invalidate or increment attempts on duplicate requests!
    if (checkDoc.status === 'verified') {
      if (checkDoc.resetTokenExpiresAt && now.getTime() < checkDoc.resetTokenExpiresAt.getTime()) {
        return res.status(200).json({
          success: true,
          message: 'Reset code verified successfully. You may now set your new password.',
        });
      }
      res.clearCookie('resetSession', getClearCookieOptions());
      return res.status(400).json({
        success: false,
        message: 'Password reset authorization has expired. Please request a new code.',
      });
    }

    if (checkDoc.status === 'delivery_failed') {
      return res.status(400).json({
        success: false,
        message: 'Email delivery encountered an issue. Please click resend to receive a new code.',
      });
    }

    // Atomic attempt tracking on unverified active record
    const resetRecord = await PasswordReset.findOneAndUpdate(
      {
        flowTokenHash,
        status: 'active',
        attempts: { $lt: MAX_OTP_ATTEMPTS },
        otpExpiresAt: { $gt: now },
        expiresAt: { $gt: now },
      },
      {
        $inc: { attempts: 1 },
      },
      { new: true }
    );

    if (!resetRecord) {
      if (now.getTime() > checkDoc.otpExpiresAt.getTime()) {
        return res.status(400).json({
          success: false,
          message: 'Verification code has expired. Please request a new code.',
          isExpired: true,
        });
      }

      await PasswordReset.deleteOne({ _id: checkDoc._id });
      res.clearCookie('resetSession', getClearCookieOptions());
      return res.status(400).json({
        success: false,
        message: 'Maximum reset verification attempts exceeded. Please initiate a new password reset request.',
      });
    }

    // Anonymous flow: constant-time failure with identical attempt count decrement
    if (resetRecord.isAnonymous) {
      await compareOtp(otp, DUMMY_HASH);
      const remaining = MAX_OTP_ATTEMPTS - resetRecord.attempts;
      if (remaining <= 0) {
        await PasswordReset.deleteOne({ _id: resetRecord._id });
        res.clearCookie('resetSession', getClearCookieOptions());
        return res.status(400).json({
          success: false,
          message: 'Maximum reset verification attempts exceeded. Please initiate a new password reset request.',
        });
      }
      return res.status(400).json({
        success: false,
        message: `Invalid reset code. You have ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} remaining.`,
      });
    }

    // Compare real OTP
    const isMatch = await compareOtp(otp, resetRecord.otpHash);
    if (!isMatch) {
      const remaining = MAX_OTP_ATTEMPTS - resetRecord.attempts;
      if (remaining <= 0) {
        await PasswordReset.deleteOne({ _id: resetRecord._id });
        res.clearCookie('resetSession', getClearCookieOptions());
        return res.status(400).json({
          success: false,
          message: 'Maximum reset verification attempts exceeded. Please initiate a new password reset request.',
        });
      }
      return res.status(400).json({
        success: false,
        message: `Invalid reset code. You have ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} remaining.`,
      });
    }

    // Generate single-use reset authorization token valid for 10 minutes
    const plainResetToken = generateResetToken();
    const hashedResetToken = hashToken(plainResetToken);

    resetRecord.status = 'verified';
    resetRecord.resetTokenHash = hashedResetToken;
    resetRecord.resetTokenExpiresAt = new Date(Date.now() + RESET_AUTH_EXPIRY_MS);
    resetRecord.otpHash = 'EXPIRED_VERIFIED';
    await resetRecord.save();

    // Re-bind cookie with verified authorization
    setFlowCookie(res, 'resetSession', { flowToken: flow.flowToken, authorized: true });

    // Critical Requirement: DO NOT return raw resetToken in JSON to frontend!
    return res.status(200).json({
      success: true,
      message: 'Reset code verified successfully. You may now set your new password.',
    });
  } catch (error) {
    console.error('[Verify Reset OTP Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify reset code.',
    });
  }
};

/**
 * 11. Resend Password Reset OTP (With atomic cooldown enforcement & anti-enumeration parity)
 */
export const resendResetOtp = async (req, res) => {
  try {
    const flow = getFlowCookie(req, 'resetSession');
    const now = new Date();

    const genericResponse = {
      success: true,
      message: 'If an account exists with this Gmail address, a new 6-digit password reset code has been sent.',
      cooldownSeconds: 60,
    };

    if (!flow || !flow.flowToken) {
      res.clearCookie('resetSession', getClearCookieOptions());
      return res.status(400).json({
        success: false,
        message: 'Password reset session has expired or is invalid. Please restart the recovery request.',
      });
    }

    const flowTokenHash = hashFlowToken(flow.flowToken);
    const existingRecord = await PasswordReset.findOne({ flowTokenHash });

    if (!existingRecord || now.getTime() >= existingRecord.expiresAt.getTime()) {
      res.clearCookie('resetSession', getClearCookieOptions());
      return res.status(400).json({
        success: false,
        message: 'Password reset session has expired or is invalid. Please restart the recovery request.',
      });
    }

    // If already verified, do not allow resending an OTP to overwrite verified authorization!
    if (existingRecord.status === 'verified') {
      return res.status(400).json({
        success: false,
        message: 'Reset authorization has already been verified. Please proceed to set your new password.',
      });
    }

    // Check cooldown
    if (now < existingRecord.resendAvailableAt) {
      const waitSeconds = Math.max(1, Math.ceil((existingRecord.resendAvailableAt.getTime() - now.getTime()) / 1000));
      return res.status(429).json({
        success: false,
        message: `Please wait ${waitSeconds} seconds before requesting another reset code.`,
        retryAfter: waitSeconds,
      });
    }

    const newOtp = generateOtp();
    const newHashedOtp = await hashOtp(newOtp);

    // Atomic conditional update enforcing active/recoverable state and non-expired flow
    const updated = await PasswordReset.findOneAndUpdate(
      {
        flowTokenHash,
        status: { $in: ['active', 'delivery_failed', 'pending_delivery'] },
        resendAvailableAt: { $lte: now },
        expiresAt: { $gt: now },
      },
      {
        $set: {
          otpHash: newHashedOtp,
          status: 'pending_delivery',
          otpExpiresAt: new Date(now.getTime() + OTP_EXPIRY_MS),
          resendAvailableAt: new Date(now.getTime() + RESEND_COOLDOWN_MS),
          attempts: 0,
          resetTokenHash: null,
          resetTokenExpiresAt: null,
          expiresAt: new Date(now.getTime() + FLOW_SESSION_EXPIRY_MS),
        },
        $inc: { otpVersion: 1 },
      },
      { new: true }
    );

    if (!updated) {
      return res.status(200).json(genericResponse);
    }

    if (updated.isAnonymous) {
      await compareOtp('123456', DUMMY_HASH);
      return res.status(200).json(genericResponse);
    }

    const currentVersion = updated.otpVersion;

    try {
      await sendPasswordResetOtpEmail(updated.email, newOtp);
      await PasswordReset.updateOne(
        { flowTokenHash, otpVersion: currentVersion },
        { $set: { status: 'active' } }
      );
    } catch (mailError) {
      logSafeMailError('resendResetOtp', mailError, updated.email);
      await PasswordReset.updateOne(
        { flowTokenHash, otpVersion: currentVersion },
        {
          $set: {
            status: 'delivery_failed',
            resendAvailableAt: new Date(),
          },
        }
      );
      return res.status(503).json({
        success: false,
        message: 'Failed to dispatch reset email. Please try again.',
      });
    }

    return res.status(200).json(genericResponse);
  } catch (error) {
    console.error('[Resend Reset OTP Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to resend reset code.',
    });
  }
};

/**
 * 12. Reset Password (Cookie-authenticated, single-use, global session revocation)
 */
export const resetPassword = async (req, res) => {
  try {
    const flow = getFlowCookie(req, 'resetSession');

    if (!flow || !flow.flowToken) {
      return res.status(400).json({
        success: false,
        message: 'Password reset session has expired or is invalid. Please request a new code.',
      });
    }

    const flowTokenHash = hashFlowToken(flow.flowToken);

    // Atomically find and consume verified authorization bound to the flow session
    const resetRecord = await PasswordReset.findOneAndDelete({
      flowTokenHash,
      status: 'verified',
      isAnonymous: false,
      resetTokenExpiresAt: { $gt: new Date() },
    });

    if (!resetRecord) {
      res.clearCookie('resetSession', getClearCookieOptions());
      return res.status(400).json({
        success: false,
        message: 'Password reset session has expired or is invalid. Please request a new code.',
      });
    }

    const user = await User.findOne({ email: resetRecord.email });
    if (!user) {
      res.clearCookie('resetSession', getClearCookieOptions());
      return res.status(400).json({
        success: false,
        message: 'User account could not be found.',
      });
    }

    // Hash new password with bcrypt (work factor 12)
    const hashedPassword = await bcrypt.hash(req.body.newPassword, 12);

    try {
      user.password = hashedPassword;
      // Increment tokenVersion to immediately invalidate all existing sessions across devices
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      await user.save();
    } catch (saveError) {
      // Safe compensation: restore reset authorization so user is not locked out if DB fails to save password
      await PasswordReset.create({
        email: resetRecord.email,
        flowTokenHash: resetRecord.flowTokenHash,
        otpHash: resetRecord.otpHash,
        otpVersion: resetRecord.otpVersion,
        status: resetRecord.status,
        isAnonymous: resetRecord.isAnonymous,
        otpExpiresAt: resetRecord.otpExpiresAt,
        resendAvailableAt: resetRecord.resendAvailableAt,
        attempts: resetRecord.attempts,
        resetTokenHash: resetRecord.resetTokenHash,
        resetTokenExpiresAt: resetRecord.resetTokenExpiresAt,
        expiresAt: resetRecord.expiresAt,
      }).catch((e) => console.error('[Failed to restore password reset authorization]', e));

      throw saveError;
    }

    // Clear reset flow cookie and active auth cookie
    res.clearCookie('resetSession', getClearCookieOptions());
    res.clearCookie('authToken', getClearCookieOptions());

    return res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. Please log in with your new password.',
    });
  } catch (error) {
    console.error('[Reset Password Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reset password. Please try again.',
    });
  }
};

/**
 * 13. Cancel Password Recovery Flow (Safe cleanup of cookie and temporary DB state)
 */
export const cancelForgotPassword = async (req, res) => {
  try {
    const flow = getFlowCookie(req, 'resetSession');
    if (flow?.flowToken) {
      const flowTokenHash = hashFlowToken(flow.flowToken);
      await PasswordReset.deleteOne({ flowTokenHash });
    }
    res.clearCookie('resetSession', getClearCookieOptions());
    return res.status(200).json({
      success: true,
      message: 'Password recovery flow has been cancelled.',
    });
  } catch (error) {
    res.clearCookie('resetSession', getClearCookieOptions());
    return res.status(200).json({
      success: true,
      message: 'Password recovery flow has been cancelled.',
    });
  }
};

/**
 * 14. Cancel Registration Flow (Safe cleanup of cookie and pending registration)
 */
export const cancelRegistration = async (req, res) => {
  try {
    const flow = getFlowCookie(req, 'regSession');
    if (flow?.flowToken) {
      const flowTokenHash = hashFlowToken(flow.flowToken);
      await PendingRegistration.deleteOne({ flowTokenHash });
    }
    res.clearCookie('regSession', getClearCookieOptions());
    return res.status(200).json({
      success: true,
      message: 'Registration flow has been cancelled.',
    });
  } catch (error) {
    res.clearCookie('regSession', getClearCookieOptions());
    return res.status(200).json({
      success: true,
      message: 'Registration flow has been cancelled.',
    });
  }
};

/**
 * 15. Protected Diagnostic Endpoint for SMTP Connectivity
 * Strictly authenticated via DIAGNOSTIC_KEY / SMTP_DIAGNOSTIC_SECRET environment variable.
 * Disabled by default (returns 404). Does not send emails, leak secrets, or accept arbitrary inputs.
 */
export const diagnosticSmtp = async (req, res) => {
  const serverKey = process.env.DIAGNOSTIC_KEY || process.env.SMTP_DIAGNOSTIC_SECRET;
  if (!serverKey || typeof serverKey !== 'string' || serverKey.length < 16) {
    return res.status(404).json({
      success: false,
      message: 'Diagnostic endpoint is not enabled.',
    });
  }

  const clientKey = req.headers['x-diagnostic-key'] || req.query.key;
  if (!clientKey || typeof clientKey !== 'string') {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Missing diagnostic authorization key.',
    });
  }

  const serverHash = crypto.createHash('sha256').update(serverKey).digest();
  const clientHash = crypto.createHash('sha256').update(clientKey).digest();
  if (!crypto.timingSafeEqual(serverHash, clientHash)) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Invalid diagnostic authorization key.',
    });
  }

  const result = await verifyEmailConnection();

  return res.status(result.success ? 200 : 503).json({
    success: result.success,
    failureStage: result.failureStage,
    errorCode: result.errorCode || null,
    details: result.details,
    provider: 'resend',
    deliveryType: 'https',
    from: config.email?.from || 'Campus Book Exchange <onboarding@resend.dev>',
    authConfigured: isEmailConfigured(),
    apiHost: 'api.resend.com',
    smtpHost: 'api.resend.com',
    smtpPort: 443,
    timestamp: new Date().toISOString(),
  });
};

export const diagnosticEmail = diagnosticSmtp;

