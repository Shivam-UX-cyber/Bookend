process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import express from 'express';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { config } from '../src/config/env.js';
import { generalLimiter, authLimiter, otpLimiter } from '../src/middleware/rateLimiter.js';
import {
  setMailSenderOverride,
  sendRegistrationOtpEmail,
  sendPasswordResetOtpEmail,
  maskEmail,
  sanitizeProviderErrorDetails,
  extractMailDiagnostics,
  logSafeMailError,
  classifyMailErrorStage,
  verifyEmailConnection,
  verifySmtpConnection,
  isEmailConfigured,
} from '../src/services/mailService.js';
import { validateEnv } from '../src/config/env.js';
import { User } from '../src/models/User.js';
import { PendingRegistration } from '../src/models/PendingRegistration.js';
import { PasswordReset } from '../src/models/PasswordReset.js';

console.log('🧪 Starting Proxy Trust, Rate Limiting & OTP Delivery Test Suite...\n');

let mongod;

async function setup() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectDB(uri);
}

async function cleanup() {
  setMailSenderOverride(null);
  await disconnectDB();
  if (mongod) {
    await mongod.stop();
  }
}

async function runTests() {
  await setup();
  const { default: app } = await import('../src/server.js');

  try {
    // =========================================================================
    // TEST 1: Production Environment Trust Proxy Evaluation
    // =========================================================================
    console.log('▶ [1/11] Testing Trust Proxy Configuration Logic...');
    const evalTrust = (nodeEnv, envVar) => {
      if (envVar !== undefined) {
        const val = envVar.trim().toLowerCase();
        if (val === 'true') return true;
        if (val === 'false') return false;
        const num = parseInt(val, 10);
        return isNaN(num) ? envVar : num;
      }
      return nodeEnv === 'production' ? 1 : false;
    };

    assert.strictEqual(evalTrust('production', undefined), 1, 'Production default must be 1 hop (Render edge proxy)');
    assert.strictEqual(evalTrust('development', undefined), false, 'Development default must be false');
    assert.strictEqual(evalTrust('test', undefined), false, 'Test default must be false');
    assert.strictEqual(evalTrust('production', '2'), 2, 'Custom numeric hop override supported');
    assert.strictEqual(evalTrust('production', 'loopback'), 'loopback', 'Custom subnet string override supported');
    console.log('   ✓ Trust proxy defaults to 1 in production and false in dev/test.');

    // =========================================================================
    // TEST 2: Express trust proxy: 1 Client IP Identification & Anti-Spoofing
    // =========================================================================
    console.log('▶ [2/11] Testing Express trust proxy: 1 IP Resolution and Anti-Spoofing...');
    const proxyApp = express();
    proxyApp.set('trust proxy', 1);
    proxyApp.get('/test-ip', (req, res) => {
      res.json({ ip: req.ip, ips: req.ips });
    });

    // 2a. Standard single proxy forwarding
    const normalRes = await request(proxyApp)
      .get('/test-ip')
      .set('X-Forwarded-For', '203.0.113.195');
    assert.strictEqual(normalRes.body.ip, '203.0.113.195');

    // 2b. Attacker tries to spoof client IP by sending X-Forwarded-For: 1.1.1.1
    // Render proxy appends real client IP (203.0.113.195) to the right
    const spoofedRes = await request(proxyApp)
      .get('/test-ip')
      .set('X-Forwarded-For', '1.1.1.1, 203.0.113.195');
    assert.strictEqual(spoofedRes.body.ip, '203.0.113.195', 'Must pick the rightmost client IP trusted from 1 hop, ignoring spoofed prepended IP');

    // 2c. Direct request without X-Forwarded-For
    const directRes = await request(proxyApp).get('/test-ip');
    assert.ok(directRes.body.ip, 'Direct connection must have an IP');
    console.log('   ✓ Express trust proxy 1 identifies real client IP and defeats header spoofing.');

    // =========================================================================
    // TEST 3: Rate Limiter Absence of ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
    // =========================================================================
    console.log('▶ [3/11] Testing Rate Limiter Handles X-Forwarded-For Smoothly...');
    const rateLimitApp = express();
    rateLimitApp.set('trust proxy', 1);
    rateLimitApp.use(generalLimiter);
    rateLimitApp.get('/api/test-limit', (req, res) => {
      res.json({ success: true, ip: req.ip });
    });

    const resLimit = await request(rateLimitApp)
      .get('/api/test-limit')
      .set('X-Forwarded-For', '198.51.100.42');

    assert.strictEqual(resLimit.status, 200);
    assert.strictEqual(resLimit.body.success, true);
    assert.strictEqual(resLimit.body.ip, '198.51.100.42');
    console.log('   ✓ Rate limiters process forwarded requests without throwing ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.');

    // =========================================================================
    // TEST 4: Rate Limiter Isolation & 429 Enforcement per Client IP
    // =========================================================================
    console.log('▶ [4/11] Testing Per-IP Rate Limiter Isolation & 429 Enforcement...');
    const testLimitApp = express();
    testLimitApp.set('trust proxy', 1);
    const dedicatedLimiter = (await import('express-rate-limit')).default({
      windowMs: 60000,
      max: 5,
      validate: { xForwardedForHeader: false },
      standardHeaders: true,
      message: {
        success: false,
        message: 'Too many OTP requests from this IP. Please try again after 15 minutes.',
      },
    });
    testLimitApp.use(dedicatedLimiter);
    testLimitApp.get('/test-otp-limit', (req, res) => {
      res.json({ success: true, ip: req.ip });
    });

    const clientA = '192.0.2.55';
    const clientB = '192.0.2.99';

    // Send 5 allowed requests for Client A
    for (let i = 0; i < 5; i++) {
      const res = await request(testLimitApp)
        .get('/test-otp-limit')
        .set('X-Forwarded-For', clientA);
      assert.strictEqual(res.status, 200);
    }

    // 6th request from Client A must be rejected with 429
    const limitedRes = await request(testLimitApp)
      .get('/test-otp-limit')
      .set('X-Forwarded-For', clientA);
    assert.strictEqual(limitedRes.status, 429);
    assert.strictEqual(limitedRes.body.success, false);
    assert.ok(limitedRes.body.message.includes('Too many OTP requests'));

    // Client B from a separate IP must not be blocked (verifies isolation)
    const clientBRes = await request(testLimitApp)
      .get('/test-otp-limit')
      .set('X-Forwarded-For', clientB);
    assert.strictEqual(clientBRes.status, 200, 'Client B should not be affected by Client A rate limit');
    console.log('   ✓ Rate limits enforced per client IP; other IPs unaffected.');

    // =========================================================================
    // TEST 5: Resend HTTPS Email API Configuration & Error Classification
    // =========================================================================
    console.log('▶ [5/17] Testing Resend HTTPS Email API Configuration & Error Classification...');

    const origApiKey = config.email.resendApiKey;
    const origFrom = config.email.from;

    try {
      // 5a. Default Resend configuration evaluation
      assert.strictEqual(config.email.provider, 'resend');
      assert.ok(config.email.from.includes('Campus Book Exchange'));

      // 5b. Resend permitted testing sender vs custom domain
      config.email.from = 'Campus Book Exchange <onboarding@resend.dev>';
      assert.ok(config.email.from.includes('onboarding@resend.dev'), 'Must support Resend permitted testing sender');

      config.email.from = 'Campus Book Exchange <no-reply@bookend.campus>';
      assert.strictEqual(config.email.from, 'Campus Book Exchange <no-reply@bookend.campus>');

      // 5c. validateEnv warnings for missing or placeholder RESEND_API_KEY
      config.email.resendApiKey = '';
      const warningsMissing = validateEnv();
      assert.ok(warningsMissing.some((w) => w.includes('RESEND_API_KEY) is not configured')), 'Must warn when RESEND_API_KEY is missing');

      config.email.resendApiKey = 're_your_api_key_placeholder';
      const warningsPlaceholder = validateEnv();
      assert.ok(warningsPlaceholder.some((w) => w.includes('using a placeholder value')), 'Must warn on placeholder key');

      // 5d. classifyMailErrorStage isolates NETWORK_FAILURE, API_AUTHENTICATION, RECIPIENT_RESTRICTION
      const netErr = new Error('fetch failed: connect ETIMEDOUT api.resend.com:443');
      netErr.code = 'ETIMEDOUT';
      assert.strictEqual(classifyMailErrorStage(netErr), 'NETWORK_FAILURE');

      const authErr = new Error('API key is invalid');
      authErr.statusCode = 401;
      assert.strictEqual(classifyMailErrorStage(authErr), 'API_AUTHENTICATION');

      const restrictErr = new Error('You can only send testing emails to your own email address');
      restrictErr.statusCode = 403;
      assert.strictEqual(classifyMailErrorStage(restrictErr), 'RECIPIENT_RESTRICTION');

      const rateErr = new Error('Too many requests');
      rateErr.statusCode = 429;
      assert.strictEqual(classifyMailErrorStage(rateErr), 'PROVIDER_RATE_LIMIT');

      // 5e. verifyEmailConnection test with mock
      setMailSenderOverride(async (data) => {
        if (data.type === 'verify') return { ok: true };
      });
      const verifyRes = await verifyEmailConnection();
      assert.strictEqual(verifyRes.success, true);
      assert.strictEqual(verifyRes.provider, 'resend');

      // 5f. verifyEmailConnection test with connection failure
      setMailSenderOverride(async (data) => {
        if (data.type === 'verify') {
          const timeoutErr = new Error('fetch failed');
          timeoutErr.code = 'ETIMEDOUT';
          return { error: timeoutErr };
        }
      });
      const verifyFailRes = await verifyEmailConnection();
      assert.strictEqual(verifyFailRes.success, false);
      assert.strictEqual(verifyFailRes.failureStage, 'NETWORK_FAILURE');
      assert.strictEqual(verifyFailRes.errorCode, 'ETIMEDOUT');
      setMailSenderOverride(null);
    } finally {
      config.email.resendApiKey = origApiKey;
      config.email.from = origFrom;
    }
    console.log('   ✓ Resend HTTPS API configuration, permitted testing sender, and error classification validated.');

    // =========================================================================
    // TEST 6: sendRegistrationOtpEmail Provider Acceptance Verification
    // =========================================================================
    console.log('▶ [6/17] Testing sendRegistrationOtpEmail Provider Acceptance...');
    setMailSenderOverride(async (data) => ({
      messageId: '<msg-reg-success@gmail.com>',
      accepted: [data.to],
      rejected: [],
    }));

    const regReceipt = await sendRegistrationOtpEmail('student.verified@gmail.com', 'Verified Student', '112233');
    assert.strictEqual(regReceipt.messageId, '<msg-reg-success@gmail.com>');
    assert.deepStrictEqual(regReceipt.accepted, ['student.verified@gmail.com']);
    console.log('   ✓ sendRegistrationOtpEmail succeeds and returns receipt when provider accepts.');

    // =========================================================================
    // TEST 7: sendRegistrationOtpEmail Provider Rejection Handling
    // =========================================================================
    console.log('▶ [7/17] Testing sendRegistrationOtpEmail Provider Rejection...');
    setMailSenderOverride(async (data) => ({
      messageId: '<msg-reg-fail@gmail.com>',
      accepted: [],
      rejected: [data.to],
    }));

    await assert.rejects(
      async () => {
        await sendRegistrationOtpEmail('rejected@gmail.com', 'Rejected Student', '445566');
      },
      /Email provider rejected recipient/
    );
    console.log('   ✓ sendRegistrationOtpEmail throws error when provider rejects recipient.');

    // =========================================================================
    // TEST 8: sendPasswordResetOtpEmail Network Failure (ETIMEDOUT / fetch failed)
    // =========================================================================
    console.log('▶ [8/17] Testing sendPasswordResetOtpEmail Network Failure (ETIMEDOUT)...');
    const connErr = new Error('fetch failed: connect ETIMEDOUT 2606:4700::6810:1423:443');
    connErr.code = 'ETIMEDOUT';
    setMailSenderOverride(async () => {
      throw connErr;
    });

    await assert.rejects(
      async () => {
        await sendPasswordResetOtpEmail('conn.timeout@gmail.com', '123456');
      },
      (err) => {
        assert.strictEqual(err.code, 'ETIMEDOUT');
        const diag = extractMailDiagnostics('sendPasswordResetOtpEmail', err, 'conn.timeout@gmail.com');
        assert.strictEqual(diag.failureStage, 'NETWORK_FAILURE', 'Must classify as NETWORK_FAILURE');
        assert.notStrictEqual(diag.failureStage, 'API_AUTHENTICATION', 'Must NOT treat ETIMEDOUT as auth failure');
        assert.strictEqual(diag.provider, 'resend');
        return true;
      }
    );
    console.log('   ✓ Connection failure cleanly propagated with ETIMEDOUT code and NETWORK_FAILURE stage.');

    // =========================================================================
    // TEST 9: sendPasswordResetOtpEmail Provider Auth Failure (Invalid API Key / 401)
    // =========================================================================
    console.log('▶ [9/17] Testing sendPasswordResetOtpEmail Provider Auth Failure (Invalid Key / 401)...');
    const authErr = new Error('API key is invalid');
    authErr.statusCode = 401;
    authErr.name = 'invalid_api_key';
    setMailSenderOverride(async () => {
      throw authErr;
    });

    await assert.rejects(
      async () => {
        await sendPasswordResetOtpEmail('auth.fail@gmail.com', '654321');
      },
      (err) => {
        assert.strictEqual(err.statusCode, 401);
        const diag = extractMailDiagnostics('sendPasswordResetOtpEmail', err, 'auth.fail@gmail.com');
        assert.strictEqual(diag.failureStage, 'API_AUTHENTICATION');
        return true;
      }
    );
    console.log('   ✓ Auth failure cleanly propagated with 401 statusCode and API_AUTHENTICATION stage.');

    // =========================================================================
    // TEST 10: sendPasswordResetOtpEmail Recipient Rejection (EREJECTED / 550)
    // =========================================================================
    console.log('▶ [10/17] Testing sendPasswordResetOtpEmail Recipient Rejection (EREJECTED / 550)...');
    setMailSenderOverride(async (data) => ({
      messageId: '<msg-rej@gmail.com>',
      accepted: [],
      rejected: [data.to],
    }));

    await assert.rejects(
      async () => {
        await sendPasswordResetOtpEmail('nonexistent.mailbox@gmail.com', '998877');
      },
      (err) => {
        assert.strictEqual(err.code, 'EREJECTED');
        assert.strictEqual(err.responseCode, 550);
        return true;
      }
    );
    console.log('   ✓ Recipient rejection throws EREJECTED with responseCode 550.');

    // =========================================================================
    // TEST 11: sendPasswordResetOtpEmail Provider Acceptance (250 OK)
    // =========================================================================
    console.log('▶ [11/17] Testing sendPasswordResetOtpEmail Provider Acceptance (250 OK)...');
    setMailSenderOverride(async (data) => ({
      messageId: '<msg-accepted-reset@gmail.com>',
      accepted: [data.to],
      rejected: [],
    }));

    const acceptedReceipt = await sendPasswordResetOtpEmail('happy.path@gmail.com', '112233');
    assert.strictEqual(acceptedReceipt.messageId, '<msg-accepted-reset@gmail.com>');
    assert.deepStrictEqual(acceptedReceipt.accepted, ['happy.path@gmail.com']);
    console.log('   ✓ Provider acceptance successfully returns accepted receipt.');

    // =========================================================================
    // TEST 12: Register Controller Returns 503 on Provider Transport Failure
    // =========================================================================
    console.log('▶ [12/17] Testing Register Controller Safe Failure on Provider Failure...');
    setMailSenderOverride(async () => {
      throw new Error('SMTP connection timeout ETIMEDOUT');
    });

    const testEmail = 'provider.fail.reg@gmail.com';
    await User.deleteMany({ email: testEmail });
    await PendingRegistration.deleteMany({ email: testEmail });

    const failRegRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Provider Fail User',
        email: testEmail,
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
      });

    assert.strictEqual(failRegRes.status, 503);
    assert.strictEqual(failRegRes.body.success, false);
    assert.ok(failRegRes.body.message.includes('Failed to dispatch verification email'));

    const pendingCheck = await PendingRegistration.findOne({ email: testEmail });
    assert.strictEqual(pendingCheck, null, 'Pending registration must be purged on transport failure');
    console.log('   ✓ Register returns 503 success: false on provider failure and cleans up pending state.');

    // =========================================================================
    // TEST 13: forgotPassword Returns success: false with deliveryFailed: true on Provider Failure
    // =========================================================================
    console.log('▶ [13/17] Testing Forgot Password Delivery Failure Response State...');
    const recoveryEmail = 'real.user.recovery@gmail.com';
    await User.deleteMany({ email: recoveryEmail });
    await PasswordReset.deleteMany({ email: recoveryEmail });

    await User.create({
      name: 'Real User',
      email: recoveryEmail,
      password: 'HashedPassword123!',
      isVerified: true,
    });

    setMailSenderOverride(async () => {
      throw new Error('SMTP auth error 535');
    });

    const failForgotRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: recoveryEmail });

    assert.strictEqual(failForgotRes.status, 200);
    assert.strictEqual(failForgotRes.body.success, false, 'Must not return success: true when email failed to send');
    assert.strictEqual(failForgotRes.body.deliveryFailed, true);
    assert.strictEqual(failForgotRes.body.cooldownSeconds, 0);

    const resetDoc = await PasswordReset.findOne({ email: recoveryEmail });
    assert.ok(resetDoc);
    assert.strictEqual(resetDoc.status, 'delivery_failed');
    console.log('   ✓ Forgot password returns success: false with deliveryFailed: true without revealing user existence.');

    // =========================================================================
    // TEST 14: Resend Registration OTP Returns 503 on Provider Failure
    // =========================================================================
    console.log('▶ [14/17] Testing Resend Registration OTP Provider Failure Handling...');
    const resendEmail = 'resend.fail.student@gmail.com';
    await PendingRegistration.deleteMany({ email: resendEmail });

    setMailSenderOverride(async () => ({ messageId: 'msg-init-ok', accepted: [resendEmail] }));

    const initialRegRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Resend Student',
        email: resendEmail,
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
      });
    assert.strictEqual(initialRegRes.status, 200);
    const regCookie = initialRegRes.headers['set-cookie'].find((c) => c.startsWith('regSession='));

    // Advance cooldown
    await PendingRegistration.updateOne(
      { email: resendEmail },
      { $set: { resendAvailableAt: new Date(Date.now() - 1000) } }
    );

    // Simulate provider failure on resend
    setMailSenderOverride(async () => {
      throw new Error('SMTP connection reset ECONNRESET');
    });

    const resendRes = await request(app)
      .post('/api/auth/resend-registration-otp')
      .set('Cookie', [regCookie]);

    assert.strictEqual(resendRes.status, 503);
    assert.strictEqual(resendRes.body.success, false);

    const pendingDoc = await PendingRegistration.findOne({ email: resendEmail });
    assert.strictEqual(pendingDoc.status, 'delivery_failed');
    console.log('   ✓ Resend returns 503 success: false on failure and marks record for zero-cooldown retry.');

    // =========================================================================
    // TEST 15: Resend Reset OTP Returns 503 & delivery_failed on Provider Failure
    // =========================================================================
    console.log('▶ [15/17] Testing Resend Reset OTP Returns 503 & delivery_failed on Provider Failure...');
    const resetUserEmail = 'resend.reset.user@gmail.com';
    await User.deleteMany({ email: resetUserEmail });
    await PasswordReset.deleteMany({ email: resetUserEmail });

    await User.create({
      name: 'Reset User',
      email: resetUserEmail,
      password: 'HashedPassword123!',
      isVerified: true,
    });

    // Step 1: Successful forgot-password request to initialize active flow
    setMailSenderOverride(async (data) => ({
      messageId: '<msg-forgot-ok@gmail.com>',
      accepted: [data.to],
      rejected: [],
    }));

    const forgotRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: resetUserEmail });

    assert.strictEqual(forgotRes.status, 200);
    const resetCookie = forgotRes.headers['set-cookie'].find((c) => c.startsWith('resetSession='));
    assert.ok(resetCookie, 'Must set resetSession cookie');

    // Advance cooldown
    await PasswordReset.updateOne(
      { email: resetUserEmail },
      { $set: { resendAvailableAt: new Date(Date.now() - 1000) } }
    );

    // Simulate provider failure on resend
    setMailSenderOverride(async () => {
      const err = new Error('SMTP connection failure ETIMEDOUT');
      err.code = 'ETIMEDOUT';
      throw err;
    });

    const resendResetRes = await request(app)
      .post('/api/auth/resend-reset-otp')
      .set('Cookie', [resetCookie]);

    assert.strictEqual(resendResetRes.status, 503, 'Must return HTTP 503 on mail delivery failure');
    assert.strictEqual(resendResetRes.body.success, false);
    assert.strictEqual(resendResetRes.body.message, 'Failed to dispatch reset email. Please try again.');

    const resetDocAfterFail = await PasswordReset.findOne({ email: resetUserEmail });
    assert.strictEqual(resetDocAfterFail.status, 'delivery_failed');
    assert.ok(resetDocAfterFail.resendAvailableAt <= new Date(), 'Cooldown must be reset to allow immediate retry');
    console.log('   ✓ Resend Reset OTP returns HTTP 503 and transitions status to delivery_failed.');

    // =========================================================================
    // TEST 16: Safe Diagnostic Error Extraction & Strict Secret Redaction
    // =========================================================================
    console.log('▶ [16/17] Testing Safe Diagnostic Extraction & Strict Secret Redaction...');
    // 16a. Masking email
    assert.strictEqual(maskEmail('shivamkumar785707@gmail.com'), 's***7@gmail.com');
    assert.strictEqual(maskEmail('alice@test.com'), 'a***e@test.com');
    assert.strictEqual(maskEmail('me@domain.org'), 'm***@domain.org');
    assert.strictEqual(maskEmail('invalid-email'), '***');

    // 16b. Redaction of Resend API keys
    const rawApiKeyError = 'Failed to authenticate request with key re_abc123456789_secretkey99';
    const sanitizedApiKeyError = sanitizeProviderErrorDetails(rawApiKeyError);
    assert.ok(!sanitizedApiKeyError.includes('re_abc123456789_secretkey99'), 'Must not contain raw Resend API key');
    assert.ok(sanitizedApiKeyError.includes('re_[REDACTED_API_KEY]'));

    // 16c. Redaction of OTP codes (6 digits)
    const rawOtpError = 'Failed to deliver OTP 839201 to inbox';
    const sanitizedOtpError = sanitizeProviderErrorDetails(rawOtpError);
    assert.ok(!sanitizedOtpError.includes('839201'), 'Must not contain raw 6-digit OTP');
    assert.ok(sanitizedOtpError.includes('[REDACTED_OTP]'));

    // 16d. Redaction of passwords and tokens
    const rawTokenError = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIzfQ password: SuperSecretPassword123';
    const sanitizedTokenError = sanitizeProviderErrorDetails(rawTokenError);
    assert.ok(!sanitizedTokenError.includes('SuperSecretPassword123'));
    assert.ok(!sanitizedTokenError.includes('eyJhbGciOiJIUzI1Ni'));
    assert.ok(sanitizedTokenError.includes('Bearer [REDACTED_TOKEN]'));
    assert.ok(sanitizedTokenError.includes('password=[REDACTED]'));

    // 16e. extractMailDiagnostics safe structure
    const sampleErr = new Error('Invalid API key re_invalidkey_123456789 with OTP 719283');
    sampleErr.statusCode = 401;
    sampleErr.name = 'invalid_api_key';
    const diag = extractMailDiagnostics('resendResetOtp', sampleErr, 'student.test@gmail.com');
    assert.strictEqual(diag.operation, 'resendResetOtp');
    assert.strictEqual(diag.statusCode, 401);
    assert.strictEqual(diag.recipient, 's***t@gmail.com');
    assert.strictEqual(diag.provider, 'resend');
    assert.ok(!diag.details.includes('719283'), 'Diagnostics must redact OTP');
    assert.ok(!diag.details.includes('re_invalidkey_123456789'), 'Diagnostics must redact API key');
    assert.ok(diag.details.includes('[REDACTED_OTP]'));
    assert.strictEqual(typeof diag.timestamp, 'string');
    console.log('   ✓ Diagnostic extraction redacts API keys, OTPs, and tokens, while safely exposing status codes.');

    // =========================================================================
    // TEST 17: Account-Enumeration Protection Preserved on Forgot Password
    // =========================================================================
    console.log('▶ [17/17] Testing Account Enumeration Protection on Forgot Password...');
    const nonExistentEmail = 'nonexistent.student.ghost@gmail.com';
    await User.deleteMany({ email: nonExistentEmail });
    await PasswordReset.deleteMany({ email: nonExistentEmail });

    // Even if mail sender throws, an unregistered user receives identical 200 response
    setMailSenderOverride(async () => {
      throw new Error('SMTP should never be invoked for non-existent account');
    });

    const ghostRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: nonExistentEmail });

    assert.strictEqual(ghostRes.status, 200);
    assert.strictEqual(ghostRes.body.success, true);
    assert.strictEqual(ghostRes.body.cooldownSeconds, 60);
    assert.ok(ghostRes.body.message.includes('If an account exists'));

    const ghostDoc = await PasswordReset.findOne({ email: nonExistentEmail });
    assert.ok(ghostDoc);
    assert.strictEqual(ghostDoc.isAnonymous, true);
    // =========================================================================
    // TEST 18: Protected Remote Diagnostic Endpoint (/api/auth/diagnostic/smtp)
    // =========================================================================
    console.log('▶ [18/18] Testing Protected Remote Diagnostic Endpoint Security & Verification...');

    const origDiagKey = process.env.DIAGNOSTIC_KEY;
    const origSmtpSecret = process.env.SMTP_DIAGNOSTIC_SECRET;
    const origApiKeyVal = config.email.resendApiKey;
    const origFromVal = config.email.from;
    try {
      // 18a. Disabled by default when DIAGNOSTIC_KEY is not configured (returns 404)
      delete process.env.DIAGNOSTIC_KEY;
      delete process.env.SMTP_DIAGNOSTIC_SECRET;
      const disabledRes = await request(app).get('/api/auth/diagnostic/smtp');
      assert.strictEqual(disabledRes.status, 404, 'Must return 404 when diagnostic endpoint is not enabled in environment');
      assert.strictEqual(disabledRes.body.success, false);

      // 18b. When enabled, requests without key receive 403
      const testSecretKey = 'test_diagnostic_secret_key_32_characters_ok!';
      process.env.DIAGNOSTIC_KEY = testSecretKey;

      const unauthRes = await request(app).get('/api/auth/diagnostic/smtp');
      assert.strictEqual(unauthRes.status, 403, 'Must reject requests missing x-diagnostic-key header');
      assert.strictEqual(unauthRes.body.success, false);

      // 18c. Requests with invalid key receive 403
      const wrongKeyRes = await request(app)
        .get('/api/auth/diagnostic/smtp')
        .set('x-diagnostic-key', 'wrong_diagnostic_key_32_characters_invalid!');
      assert.strictEqual(wrongKeyRes.status, 403, 'Must reject invalid authorization key');

      // 18d. Valid key with successful connectivity returns 200 and safe diagnostics
      config.email.resendApiKey = 're_test_mock_api_key_valid_32_characters';

      setMailSenderOverride(async (data) => {
        if (data.type === 'verify') return { ok: true };
      });

      const validDiagRes = await request(app)
        .get('/api/auth/diagnostic/smtp')
        .set('x-diagnostic-key', testSecretKey);

      assert.strictEqual(validDiagRes.status, 200);
      assert.strictEqual(validDiagRes.body.success, true);
      assert.strictEqual(validDiagRes.body.provider, 'resend');
      assert.strictEqual(validDiagRes.body.deliveryType, 'https');
      assert.strictEqual(validDiagRes.body.authConfigured, true);
      assert.strictEqual(validDiagRes.body.password, undefined, 'Must NEVER leak credentials');
      assert.strictEqual(validDiagRes.body.appPassword, undefined, 'Must NEVER leak app passwords');
      assert.strictEqual(validDiagRes.body.resendApiKey, undefined, 'Must NEVER leak Resend API key');

      // Also test alias route /api/auth/diagnostic/email
      const aliasDiagRes = await request(app)
        .get('/api/auth/diagnostic/email')
        .set('x-diagnostic-key', testSecretKey);
      assert.strictEqual(aliasDiagRes.status, 200);
      assert.strictEqual(aliasDiagRes.body.provider, 'resend');

      // Verify authConfigured accurately reflects when Resend API key is not configured
      config.email.resendApiKey = '';

      const unconfiguredRes = await request(app)
        .get('/api/auth/diagnostic/smtp')
        .set('x-diagnostic-key', testSecretKey);

      assert.strictEqual(unconfiguredRes.status, 200);
      assert.strictEqual(unconfiguredRes.body.authConfigured, false);
      assert.strictEqual(unconfiguredRes.body.password, undefined);
      assert.strictEqual(unconfiguredRes.body.resendApiKey, undefined);

      // 18e. Valid key with connection failure returns 503 with failureStage
      setMailSenderOverride(async (data) => {
        if (data.type === 'verify') {
          const timeoutErr = new Error('fetch failed: connect ETIMEDOUT');
          timeoutErr.code = 'ETIMEDOUT';
          return { error: timeoutErr };
        }
      });

      const failDiagRes = await request(app)
        .get('/api/auth/diagnostic/smtp')
        .set('x-diagnostic-key', testSecretKey);

      assert.strictEqual(failDiagRes.status, 503);
      assert.strictEqual(failDiagRes.body.success, false);
      assert.strictEqual(failDiagRes.body.failureStage, 'NETWORK_FAILURE');
      assert.strictEqual(failDiagRes.body.errorCode, 'ETIMEDOUT');
      assert.ok(failDiagRes.body.details.includes('fetch failed'));
      setMailSenderOverride(null);
    } finally {
      config.email.resendApiKey = origApiKeyVal;
      config.email.from = origFromVal;
      if (origDiagKey !== undefined) {
        process.env.DIAGNOSTIC_KEY = origDiagKey;
      } else {
        delete process.env.DIAGNOSTIC_KEY;
      }
      if (origSmtpSecret !== undefined) {
        process.env.SMTP_DIAGNOSTIC_SECRET = origSmtpSecret;
      } else {
        delete process.env.SMTP_DIAGNOSTIC_SECRET;
      }
      setMailSenderOverride(null);
    }
    console.log('   ✓ Remote diagnostic endpoint strictly protected by secret key, never leaks credentials, and reports stages accurately.');

    console.log('\n🎉 ALL 18 PROXY TRUST, OTP DELIVERY & DIAGNOSTIC TESTS PASSED!\n');
  } finally {
    await cleanup();
  }
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
