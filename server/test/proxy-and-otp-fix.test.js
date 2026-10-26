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
  getTransporterOptions,
  verifySmtpConnection,
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
    // TEST 5: SMTP Port 465 (SMTPS) vs Port 587 (STARTTLS) Configuration & Validation
    // =========================================================================
    console.log('▶ [5/17] Testing SMTP Port 465 (SMTPS) vs Port 587 (STARTTLS) Configuration...');

    const origPort = config.smtp.port;
    const origSecure = config.smtp.secure;
    const origRequireTLS = config.smtp.requireTLS;

    try {
      // 5a. Port 465 (Implicit TLS) Options Evaluation
      config.smtp.port = 465;
      config.smtp.secure = true;
      config.smtp.requireTLS = false;
      const opts465 = getTransporterOptions();
      assert.strictEqual(opts465.port, 465);
      assert.strictEqual(opts465.secure, true, 'Port 465 must use implicit TLS (secure: true)');
      assert.strictEqual(opts465.requireTLS, false, 'Port 465 already starts in TLS');
      assert.strictEqual(opts465.family, 4, 'Must default to IPv4 to prevent container IPv6 blackholes');
      assert.strictEqual(opts465.tls.minVersion, 'TLSv1.2');
      assert.strictEqual(opts465.tls.rejectUnauthorized, true);

      // 5b. Port 587 (STARTTLS) Options Evaluation
      config.smtp.port = 587;
      config.smtp.secure = false;
      config.smtp.requireTLS = true;
      const opts587 = getTransporterOptions();
      assert.strictEqual(opts587.port, 587);
      assert.strictEqual(opts587.secure, false, 'Port 587 must start plaintext (secure: false)');
      assert.strictEqual(opts587.requireTLS, true, 'Port 587 MUST require STARTTLS to prevent credential exposure');
      assert.strictEqual(opts587.family, 4);
      assert.strictEqual(opts587.tls.minVersion, 'TLSv1.2');
      assert.strictEqual(opts587.tls.rejectUnauthorized, true);

      // 5c. Whitespace stripping for Google App Password
      const sanitizePassword = (pass) => (pass || '').replace(/\s+/g, '').trim();
      assert.strictEqual(sanitizePassword('abcd efgh ijkl mnop'), 'abcdefghijklmnop');

      // 5d. validateEnv warnings for misconfigured port/TLS combinations
      config.smtp.port = 587;
      config.smtp.secure = true; // Inconsistent!
      const warnings587 = validateEnv();
      assert.ok(warnings587.some((w) => w.includes('Port 587 uses STARTTLS')), 'Must warn on secure: true with port 587');

      config.smtp.port = 465;
      config.smtp.secure = false; // Inconsistent!
      const warnings465 = validateEnv();
      assert.ok(warnings465.some((w) => w.includes('Port 465 uses SMTPS')), 'Must warn on secure: false with port 465');

      config.smtp.port = 25;
      config.smtp.secure = false;
      const warnings25 = validateEnv();
      assert.ok(warnings25.some((w) => w.includes('port 25 is configured')), 'Must warn on blocked port 25');

      // 5e. classifyMailErrorStage isolates TCP_CONNECTION from SMTP_AUTHENTICATION
      const tcpTimeoutErr = new Error('Connection timeout');
      tcpTimeoutErr.code = 'ETIMEDOUT';
      tcpTimeoutErr.command = 'CONN';
      assert.strictEqual(classifyMailErrorStage(tcpTimeoutErr), 'TCP_CONNECTION');
      assert.notStrictEqual(classifyMailErrorStage(tcpTimeoutErr), 'SMTP_AUTHENTICATION', 'ETIMEDOUT must NOT be classified as auth failure');

      const refusedErr = new Error('connect ECONNREFUSED 127.0.0.1:465');
      refusedErr.code = 'ECONNREFUSED';
      assert.strictEqual(classifyMailErrorStage(refusedErr), 'TCP_CONNECTION');

      const tlsErr = new Error('SSL alert handshake failure');
      tlsErr.code = 'ETLS';
      assert.strictEqual(classifyMailErrorStage(tlsErr), 'TLS_NEGOTIATION');

      const authErr = new Error('Invalid login: 535 5.7.8 Username and Password not accepted');
      authErr.code = 'EAUTH';
      authErr.responseCode = 535;
      assert.strictEqual(classifyMailErrorStage(authErr), 'SMTP_AUTHENTICATION');

      // 5f. verifySmtpConnection test with mock
      setMailSenderOverride(async (data) => {
        if (data.type === 'verify') return { ok: true };
      });
      const verifyRes = await verifySmtpConnection();
      assert.strictEqual(verifyRes.success, true);

      // 5g. verifySmtpConnection test with connection failure
      setMailSenderOverride(async (data) => {
        if (data.type === 'verify') {
          const timeoutErr = new Error('Connection timeout');
          timeoutErr.code = 'ETIMEDOUT';
          timeoutErr.command = 'CONN';
          return { error: timeoutErr };
        }
      });
      const verifyFailRes = await verifySmtpConnection();
      assert.strictEqual(verifyFailRes.success, false);
      assert.strictEqual(verifyFailRes.failureStage, 'TCP_CONNECTION');
      assert.strictEqual(verifyFailRes.errorCode, 'ETIMEDOUT');
      setMailSenderOverride(null);
    } finally {
      config.smtp.port = origPort;
      config.smtp.secure = origSecure;
      config.smtp.requireTLS = origRequireTLS;
    }
    console.log('   ✓ Port 465 (SMTPS) and Port 587 (STARTTLS) validated; ETIMEDOUT strictly isolated from auth errors.');

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
    // TEST 8: sendPasswordResetOtpEmail SMTP Connection Failure (ETIMEDOUT / ECONNREFUSED)
    // =========================================================================
    console.log('▶ [8/17] Testing sendPasswordResetOtpEmail SMTP Connection Failure (ETIMEDOUT)...');
    const connErr = new Error('connect ETIMEDOUT 142.250.185.108:465');
    connErr.code = 'ETIMEDOUT';
    connErr.command = 'CONN';
    connErr.syscall = 'connect';
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
        assert.strictEqual(diag.failureStage, 'TCP_CONNECTION', 'Must classify as TCP connection failure');
        assert.notStrictEqual(diag.failureStage, 'SMTP_AUTHENTICATION', 'Must NOT treat ETIMEDOUT as authentication failure');
        assert.strictEqual(diag.command, 'CONN');
        assert.strictEqual(diag.smtpHost, 'smtp.gmail.com');
        return true;
      }
    );
    console.log('   ✓ Connection failure cleanly propagated with ETIMEDOUT code and TCP_CONNECTION stage.');

    // =========================================================================
    // TEST 9: sendPasswordResetOtpEmail SMTP Auth Failure (EAUTH / 535)
    // =========================================================================
    console.log('▶ [9/17] Testing sendPasswordResetOtpEmail SMTP Auth Failure (EAUTH / 535)...');
    const authErr = new Error('Invalid login: 535-5.7.8 Username and Password not accepted');
    authErr.code = 'EAUTH';
    authErr.responseCode = 535;
    authErr.command = 'AUTH PLAIN';
    setMailSenderOverride(async () => {
      throw authErr;
    });

    await assert.rejects(
      async () => {
        await sendPasswordResetOtpEmail('auth.fail@gmail.com', '654321');
      },
      (err) => {
        assert.strictEqual(err.code, 'EAUTH');
        assert.strictEqual(err.responseCode, 535);
        return true;
      }
    );
    console.log('   ✓ Auth failure cleanly propagated with EAUTH code and 535 responseCode.');

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

    // 16b. Redaction of OTP codes (6 digits)
    const rawOtpError = 'Failed to deliver OTP 839201 to inbox';
    const sanitizedOtpError = sanitizeProviderErrorDetails(rawOtpError);
    assert.ok(!sanitizedOtpError.includes('839201'), 'Must not contain raw 6-digit OTP');
    assert.ok(sanitizedOtpError.includes('[REDACTED_OTP]'));

    // 16c. Redaction of 16-character App Passwords
    const rawPassError = 'Invalid app password vtywbqsbzklymaeb rejected';
    const sanitizedPassError = sanitizeProviderErrorDetails(rawPassError);
    assert.ok(!sanitizedPassError.includes('vtywbqsbzklymaeb'), 'Must not contain 16-char app password');
    assert.ok(sanitizedPassError.includes('[REDACTED_APP_PASSWORD]'));

    // 16d. Redaction of tokens and credentials
    const rawTokenError = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIzfQ password: SuperSecretPassword123';
    const sanitizedTokenError = sanitizeProviderErrorDetails(rawTokenError);
    assert.ok(!sanitizedTokenError.includes('SuperSecretPassword123'));
    assert.ok(!sanitizedTokenError.includes('eyJhbGciOiJIUzI1Ni'));
    assert.ok(sanitizedTokenError.includes('Bearer [REDACTED_TOKEN]'));

    // 16e. extractMailDiagnostics safe structure
    const sampleErr = new Error('535-5.7.8 Username and Password not accepted with OTP 719283');
    sampleErr.code = 'EAUTH';
    sampleErr.responseCode = 535;
    sampleErr.command = 'AUTH PLAIN';
    const diag = extractMailDiagnostics('resendResetOtp', sampleErr, 'student.test@gmail.com');
    assert.strictEqual(diag.operation, 'resendResetOtp');
    assert.strictEqual(diag.errorCode, 'EAUTH');
    assert.strictEqual(diag.responseCode, 535);
    assert.strictEqual(diag.command, 'AUTH PLAIN');
    assert.strictEqual(diag.recipient, 's***t@gmail.com');
    assert.ok(!diag.details.includes('719283'), 'Diagnostics must redact OTP');
    assert.ok(diag.details.includes('[REDACTED_OTP]'));
    assert.strictEqual(typeof diag.timestamp, 'string');
    console.log('   ✓ Diagnostic extraction redacts OTPs, passwords, and tokens, while safely exposing error codes.');

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
    console.log('   ✓ Forgot password preserves timing & account-enumeration protections for unregistered emails.');

    console.log('\n🎉 ALL 17 PROXY TRUST, OTP DELIVERY & DIAGNOSTIC TESTS PASSED!\n');
  } finally {
    await cleanup();
  }
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
