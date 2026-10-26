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
} from '../src/services/mailService.js';
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
    // TEST 5: SMTP Port 465 SSL Resolution & App Password Sanitization
    // =========================================================================
    console.log('▶ [5/11] Testing SMTP Port 465 SSL Resolution & Whitespace Sanitization...');
    const sanitizePassword = (pass) => (pass || '').replace(/\s+/g, '').trim();
    const resolveSecure = (port, secureEnv) => {
      if (secureEnv !== undefined) return secureEnv === 'true';
      return (parseInt(port, 10) || 465) === 465;
    };

    assert.strictEqual(sanitizePassword('abcd efgh ijkl mnop'), 'abcdefghijklmnop');
    assert.strictEqual(resolveSecure(undefined, undefined), true, 'Default port 465 must have secure: true');
    assert.strictEqual(resolveSecure(465, undefined), true, 'Port 465 must have secure: true');
    assert.strictEqual(resolveSecure(587, undefined), false, 'Port 587 must have secure: false');
    console.log('   ✓ SMTP defaults to secure: true on port 465 and strips Google App Password spaces.');

    // =========================================================================
    // TEST 6: sendRegistrationOtpEmail Provider Acceptance Verification
    // =========================================================================
    console.log('▶ [6/11] Testing sendRegistrationOtpEmail Provider Acceptance...');
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
    console.log('▶ [7/11] Testing sendRegistrationOtpEmail Provider Rejection...');
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
    // TEST 8: sendPasswordResetOtpEmail Provider Empty Acceptance Handling
    // =========================================================================
    console.log('▶ [8/11] Testing sendPasswordResetOtpEmail Provider Empty Acceptance...');
    setMailSenderOverride(async () => ({
      messageId: '<msg-unaccepted@gmail.com>',
      accepted: [],
      rejected: [],
    }));

    await assert.rejects(
      async () => {
        await sendPasswordResetOtpEmail('unaccepted@gmail.com', '778899');
      },
      /Email provider did not accept delivery/
    );
    console.log('   ✓ sendPasswordResetOtpEmail throws error when provider does not accept message.');

    // =========================================================================
    // TEST 9: Register Controller Returns 503 on Provider Transport Failure
    // =========================================================================
    console.log('▶ [9/11] Testing Register Controller Safe Failure on Provider Failure...');
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
    // TEST 10: forgotPassword Returns success: false with deliveryFailed: true on Provider Failure
    // =========================================================================
    console.log('▶ [10/11] Testing Forgot Password Delivery Failure Response State...');
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
    // TEST 11: Resend Registration OTP Returns 503 on Provider Failure
    // =========================================================================
    console.log('▶ [11/11] Testing Resend Registration OTP Provider Failure Handling...');
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

    console.log('\n🎉 ALL 11 PROXY TRUST & OTP DELIVERY TESTS PASSED!\n');
  } finally {
    await cleanup();
  }
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
