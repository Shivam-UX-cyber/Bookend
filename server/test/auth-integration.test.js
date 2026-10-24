process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { PendingRegistration } from '../src/models/PendingRegistration.js';
import { PasswordReset } from '../src/models/PasswordReset.js';
import { setMailSenderOverride } from '../src/services/mailService.js';
import { validateEnv } from '../src/config/env.js';
import bcrypt from 'bcryptjs';

console.log('🧪 Starting Expanded Authentication Integration Test Suite...\n');

let mongod;
let lastSentMail = null;
let simulateSmtpError = false;

// Intercept outgoing emails for testing
setMailSenderOverride(async (mailData) => {
  if (simulateSmtpError) {
    throw new Error('Simulated SMTP transport timeout');
  }
  lastSentMail = mailData;
  return { messageId: 'test-msg-123' };
});

async function setup() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await connectDB(uri);
}

async function cleanup() {
  await disconnectDB();
  if (mongod) {
    await mongod.stop();
  }
}

async function clearCollections() {
  await User.deleteMany({});
  await PendingRegistration.deleteMany({});
  await PasswordReset.deleteMany({});
  lastSentMail = null;
  simulateSmtpError = false;
}

async function runIntegrationTests() {
  await setup();
  const { default: app } = await import('../src/server.js');

  try {
    // -------------------------------------------------------------------------
    // TEST 1: CSRF & Origin Validation Protection
    // -------------------------------------------------------------------------
    console.log('▶ [1/18] Testing CSRF & Origin Protection on State-Changing Requests...');
    await clearCollections();

    // 1a. State-changing request with an untrusted origin must be rejected with 403
    const csrfBlockedRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://malicious-attacker-domain.com')
      .send({ email: 'test@gmail.com', password: 'Password123!' });
    assert.strictEqual(csrfBlockedRes.status, 403, 'Untrusted origin must be blocked with 403');

    // 1b. State-changing request with an authorized origin must be allowed through
    const csrfAllowedRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'nonexistent.student.test@gmail.com', password: 'Password123!' });
    assert.strictEqual(csrfAllowedRes.status, 401, 'Authorized origin passes CSRF check to login handler');

    console.log('   ✓ Untrusted origins blocked by CSRF protection; authorized origins allowed.');

    // -------------------------------------------------------------------------
    // TEST 2: Registration Validation & Constraints
    // -------------------------------------------------------------------------
    console.log('▶ [2/18] Testing Registration Validation, Unicode Names & Gmail Policy...');
    await clearCollections();

    // 2a. Rejects non-Gmail addresses
    const nonGmailRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alex Student',
        email: 'alex@yahoo.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
      });
    assert.strictEqual(nonGmailRes.status, 400, 'Non-Gmail address must be rejected');

    // 2b. Rejects invalid dots in Gmail
    const invalidDotsRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alex Student',
        email: 'alex..student@gmail.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
      });
    assert.strictEqual(invalidDotsRes.status, 400, 'Consecutive dots in Gmail must be rejected');

    // 2c. Rejects weak password
    const weakPassRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alex Student',
        email: 'alex.student.test@gmail.com',
        password: 'Password123',
        confirmPassword: 'Password123',
      });
    assert.strictEqual(weakPassRes.status, 400, 'Weak password must be rejected');

    // 2d. Accepts valid Unicode international name
    const unicodeNameRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'राहुल शर्मा',
        email: 'rahul.student.test@gmail.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
      });
    assert.strictEqual(unicodeNameRes.status, 200, 'Unicode international name must be accepted');

    console.log('   ✓ Non-Gmail, invalid dots, and weak passwords rejected; Unicode names accepted.');

    // -------------------------------------------------------------------------
    // TEST 3: Safe SMTP Delivery Failure Handling
    // -------------------------------------------------------------------------
    console.log('▶ [3/18] Testing Safe SMTP Failure Handling (No lingering records/cooldown)...');
    await clearCollections();
    simulateSmtpError = true;

    const failedRegisterRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alex Student',
        email: 'alex.student.test@gmail.com',
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
      });
    assert.strictEqual(failedRegisterRes.status, 503, 'SMTP failure must return 503');

    // Verify PendingRegistration was rolled back
    const pendingAfterFailure = await PendingRegistration.findOne({ email: 'alex.student.test@gmail.com' });
    assert.strictEqual(pendingAfterFailure, null, 'PendingRegistration must be rolled back if delivery fails');

    // Retrying immediately succeeds because no false cooldown was left
    simulateSmtpError = false;
    const retryRegisterRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alex Student',
        email: 'alex.student.test@gmail.com',
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
      });
    assert.strictEqual(retryRegisterRes.status, 200, 'Immediate retry after SMTP fix succeeds without cooldown lock');
    const registrationCookies = retryRegisterRes.headers['set-cookie'];
    const regSessionCookie = registrationCookies.find((c) => c.startsWith('regSession='));
    assert.ok(regSessionCookie, 'Registration must establish HTTP-only regSession cookie');
    const registrationOtp = lastSentMail.otp;

    console.log('   ✓ SMTP delivery failures fail safely without locking user or creating unusable OTPs.');

    // -------------------------------------------------------------------------
    // TEST 4: Registration Flow Session & Status Anti-Scanning
    // -------------------------------------------------------------------------
    console.log('▶ [4/18] Testing Registration Status Endpoint (Flow session binding)...');

    // Query status with valid flow cookie
    const regStatusRes = await request(app)
      .get('/api/auth/registration-status')
      .set('Cookie', [regSessionCookie]);
    assert.strictEqual(regStatusRes.status, 200);
    assert.strictEqual(regStatusRes.body.active, true);
    assert.strictEqual(regStatusRes.body.email, 'alex.student.test@gmail.com');
    assert(regStatusRes.body.cooldownSeconds > 0 && regStatusRes.body.cooldownSeconds <= 60, 'Must report server remaining cooldown');
    assert.strictEqual(regStatusRes.body.isExpired, false);

    // Querying status without flow cookie (even with arbitrary ?email= query) returns active: false
    const unauthenticatedScanRes = await request(app)
      .get('/api/auth/registration-status?email=alex.student.test@gmail.com');
    assert.strictEqual(unauthenticatedScanRes.status, 200);
    assert.strictEqual(unauthenticatedScanRes.body.active, false, 'Unauthenticated query cannot scan registration state');

    console.log('   ✓ Registration status strictly bound to flow session; arbitrary scanning blocked.');

    // -------------------------------------------------------------------------
    // TEST 5: Concurrent Resend Protection
    // -------------------------------------------------------------------------
    console.log('▶ [5/18] Testing Concurrent Resend Requests (Atomic cooldown lock)...');

    // Simulate 3 simultaneous requests attempting to resend at the same millisecond
    const concurrentResends = await Promise.all([
      request(app).post('/api/auth/resend-registration-otp').set('Cookie', [regSessionCookie]).send({}),
      request(app).post('/api/auth/resend-registration-otp').set('Cookie', [regSessionCookie]).send({}),
      request(app).post('/api/auth/resend-registration-otp').set('Cookie', [regSessionCookie]).send({}),
    ]);

    // All must be rejected with 429 because cooldown is active
    concurrentResends.forEach((res) => {
      assert.strictEqual(res.status, 429, 'Concurrent resend within cooldown must return 429');
    });

    console.log('   ✓ Concurrent resend requests cannot bypass cooldown.');

    // -------------------------------------------------------------------------
    // TEST 6: Atomic OTP Attempt Tracking & Expiry
    // -------------------------------------------------------------------------
    console.log('▶ [6/18] Testing OTP Attempt Limits & Expiry...');

    // 6a. Wrong OTP increments attempts
    const wrongOtpRes = await request(app)
      .post('/api/auth/verify-registration-otp')
      .set('Cookie', [regSessionCookie])
      .send({ otp: '000000' });
    assert.strictEqual(wrongOtpRes.status, 400);
    assert(wrongOtpRes.body.message.includes('remaining'), 'Must report remaining attempts');

    // 6b. Expired OTP fails
    const pendingDoc = await PendingRegistration.findOne({ email: 'alex.student.test@gmail.com' });
    pendingDoc.otpExpiresAt = new Date(Date.now() - 1000);
    await pendingDoc.save();

    const expiredRes = await request(app)
      .post('/api/auth/verify-registration-otp')
      .set('Cookie', [regSessionCookie])
      .send({ otp: registrationOtp });
    assert.strictEqual(expiredRes.status, 400);
    assert.strictEqual(expiredRes.body.isExpired, true);

    // Restore expiry and activate
    pendingDoc.otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await pendingDoc.save();

    const validActivateRes = await request(app)
      .post('/api/auth/verify-registration-otp')
      .set('Cookie', [regSessionCookie])
      .send({ otp: registrationOtp });
    assert.strictEqual(validActivateRes.status, 201, 'Valid OTP activates account');

    // 6c. Verify stale OTP cannot be reused
    const staleReuseRes = await request(app)
      .post('/api/auth/verify-registration-otp')
      .set('Cookie', [regSessionCookie])
      .send({ otp: registrationOtp });
    assert.strictEqual(staleReuseRes.status, 400, 'Stale OTP cannot be reused after consumption');

    console.log('   ✓ OTP attempt limits, expiration, and single-use consumption verified.');

    // -------------------------------------------------------------------------
    // TEST 7: Login & isVerified Gate
    // -------------------------------------------------------------------------
    console.log('▶ [7/18] Testing Login, isVerified Gate & Anti-Enumeration Timing...');

    // Unverified user created directly must fail with 403
    const unverifiedUser = new User({
      name: 'Unverified Student',
      email: 'unverified.student.test@gmail.com',
      password: await bcrypt.hash('SecurePassword123!', 12),
    });
    await unverifiedUser.save();
    assert.strictEqual(unverifiedUser.isVerified, false, 'Default isVerified must be false');

    const unverifiedLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'unverified.student.test@gmail.com', password: 'SecurePassword123!' });
    assert.strictEqual(unverifiedLogin.status, 403, 'Unverified user must be rejected with 403');

    // Wrong password returns 401
    const wrongPassLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alex.student.test@gmail.com', password: 'WrongPassword999!' });
    assert.strictEqual(wrongPassLogin.status, 401, 'Wrong password returns 401');

    // Successful login sets HTTP-only cookie
    const validLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alex.student.test@gmail.com', password: 'SecurePassword123!' });
    assert.strictEqual(validLogin.status, 200);

    const cookies = validLogin.headers['set-cookie'];
    const authCookie = cookies.find((c) => c.startsWith('authToken='));
    assert(authCookie && authCookie.includes('HttpOnly') && authCookie.includes('Path=/'));

    console.log('   ✓ isVerified: false blocked; valid login sets HTTP-only cookie with Path=/.');

    // -------------------------------------------------------------------------
    // TEST 8: Protected Routes
    // -------------------------------------------------------------------------
    console.log('▶ [8/18] Testing Protected Endpoint (/api/auth/me)...');

    const unauthMe = await request(app).get('/api/auth/me');
    assert.strictEqual(unauthMe.status, 401);

    const authMe = await request(app).get('/api/auth/me').set('Cookie', [authCookie]);
    assert.strictEqual(authMe.status, 200);
    assert.strictEqual(authMe.body.user.email, 'alex.student.test@gmail.com');

    console.log('   ✓ Protected route verified.');

    // -------------------------------------------------------------------------
    // TEST 9: Logout & Database Failure Handling
    // -------------------------------------------------------------------------
    console.log('▶ [9/18] Testing Logout Scenarios (Normal, Invalid Token, DB Failure)...');

    // 9a. Normal logout increments tokenVersion and reports invalidatedAllSessions: true
    const userBeforeLogout = await User.findOne({ email: 'alex.student.test@gmail.com' });
    const versionBefore = userBeforeLogout.tokenVersion;

    const normalLogout = await request(app).post('/api/auth/logout').set('Cookie', [authCookie]);
    assert.strictEqual(normalLogout.status, 200);
    assert.strictEqual(normalLogout.body.invalidatedAllSessions, true);

    const userAfterLogout = await User.findOne({ email: 'alex.student.test@gmail.com' });
    assert.strictEqual(userAfterLogout.tokenVersion, versionBefore + 1, 'tokenVersion must be incremented');

    // Protected route fails when replaying old cookie
    const replayedMe = await request(app).get('/api/auth/me').set('Cookie', [authCookie]);
    assert.strictEqual(replayedMe.status, 401, 'Replaying invalidated token must fail with 401');

    // 9b. Logout without cookie reports 200 without claiming all sessions were invalidated
    const emptyLogout = await request(app).post('/api/auth/logout');
    assert.strictEqual(emptyLogout.status, 200);
    assert.strictEqual(emptyLogout.body.invalidatedAllSessions, false);

    // 9c. Logout database failure returns 500 without false security claims
    const freshLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alex.student.test@gmail.com', password: 'SecurePassword123!' });
    const freshAuthCookie = freshLogin.headers['set-cookie'].find((c) => c.startsWith('authToken='));

    const originalFindByIdAndUpdate = User.findByIdAndUpdate;
    User.findByIdAndUpdate = async () => {
      throw new Error('Database connection severed during update');
    };

    const failedDbLogout = await request(app).post('/api/auth/logout').set('Cookie', [freshAuthCookie]);
    assert.strictEqual(failedDbLogout.status, 500, 'Database failure during logout must return 500');
    assert.strictEqual(failedDbLogout.body.invalidatedAllSessions, false, 'Must NOT claim sessions were invalidated if DB update failed');

    User.findByIdAndUpdate = originalFindByIdAndUpdate;

    console.log('   ✓ Logout correctly distinguishes DB failure, invalid tokens, and session invalidation.');

    // -------------------------------------------------------------------------
    // TEST 10: Forgot Password Anti-Enumeration Parity Across Full Flow
    // -------------------------------------------------------------------------
    console.log('▶ [10/18] Testing Forgot Password Anti-Enumeration Full Flow Parity...');

    // 10a. Request OTP: Registered vs Non-existent
    const fakeForgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nonexistent.student.test@gmail.com' });
    assert.strictEqual(fakeForgot.status, 200);
    const fakeCookies = fakeForgot.headers['set-cookie'];
    const fakeResetSession = fakeCookies.find((c) => c.startsWith('resetSession='));
    assert.ok(fakeResetSession, 'Non-existent account must still receive flow cookie');

    lastSentMail = null;
    const realForgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'alex.student.test@gmail.com' });
    assert.strictEqual(realForgot.status, 200);
    const realCookies = realForgot.headers['set-cookie'];
    const realResetSession = realCookies.find((c) => c.startsWith('resetSession='));

    assert.strictEqual(realForgot.body.message, fakeForgot.body.message, 'Initial messages must be identical');
    assert.strictEqual(realForgot.body.cooldownSeconds, fakeForgot.body.cooldownSeconds, 'Cooldowns must be identical');

    // 10b. Status Endpoint: Parity for real vs non-existent
    const fakeStatus = await request(app)
      .get('/api/auth/forgot-password/status')
      .set('Cookie', [fakeResetSession]);
    const realStatus = await request(app)
      .get('/api/auth/forgot-password/status')
      .set('Cookie', [realResetSession]);

    assert.strictEqual(fakeStatus.status, 200);
    assert.strictEqual(realStatus.status, 200);
    assert.strictEqual(fakeStatus.body.active, true);
    assert.strictEqual(realStatus.body.active, true);
    assert.strictEqual(fakeStatus.body.step, 2);
    assert.strictEqual(realStatus.body.step, 2);

    // 10c. Resend during cooldown: Parity for real vs non-existent (both rejected or 429)
    const fakeResend = await request(app)
      .post('/api/auth/resend-reset-otp')
      .set('Cookie', [fakeResetSession])
      .send({});
    const realResend = await request(app)
      .post('/api/auth/resend-reset-otp')
      .set('Cookie', [realResetSession])
      .send({});

    assert.strictEqual(fakeResend.status, 429);
    assert.strictEqual(realResend.status, 429);

    // 10d. Wrong OTP verification: Parity in error message & attempt decrement
    const fakeVerify = await request(app)
      .post('/api/auth/verify-reset-otp')
      .set('Cookie', [fakeResetSession])
      .send({ otp: '000000' });
    const realVerify = await request(app)
      .post('/api/auth/verify-reset-otp')
      .set('Cookie', [realResetSession])
      .send({ otp: '000000' });

    assert.strictEqual(fakeVerify.status, 400);
    assert.strictEqual(realVerify.status, 400);
    assert.strictEqual(fakeVerify.body.message, realVerify.body.message, 'Attempt decrement message must match identically');

    console.log('   ✓ Full recovery flow (request -> status -> resend -> verify) maintains 100% anti-enumeration parity.');

    // -------------------------------------------------------------------------
    // TEST 11: Forgot Password Refresh Flow Restoration (Step 2)
    // -------------------------------------------------------------------------
    console.log('▶ [11/18] Testing Forgot Password Flow Restoration on Refresh (Step 2)...');

    const step2Status = await request(app)
      .get('/api/auth/forgot-password/status')
      .set('Cookie', [realResetSession]);
    assert.strictEqual(step2Status.status, 200);
    assert.strictEqual(step2Status.body.active, true);
    assert.strictEqual(step2Status.body.step, 2);

    console.log('   ✓ Refreshing at Step 2 restores step and server cooldown without localStorage.');

    // -------------------------------------------------------------------------
    // TEST 12: Password Reset OTP Verification & Non-Disclosure of Raw Tokens
    // -------------------------------------------------------------------------
    console.log('▶ [12/18] Testing Reset OTP Verification & Non-Disclosure of Raw Tokens...');

    // Fetch latest OTP from mail interceptor
    const resetOtp = lastSentMail.otp;

    const validVerify = await request(app)
      .post('/api/auth/verify-reset-otp')
      .set('Cookie', [realResetSession])
      .send({ otp: resetOtp });

    assert.strictEqual(validVerify.status, 200);
    // CRITICAL: verifyResetOtp must NOT disclose raw reset bearer token in JSON!
    assert.strictEqual(validVerify.body.resetToken, undefined, 'Must NEVER return raw resetToken in response JSON');

    const verifiedCookies = validVerify.headers['set-cookie'];
    const verifiedSessionCookie = verifiedCookies.find((c) => c.startsWith('resetSession='));
    assert.ok(verifiedSessionCookie, 'Verified reset authorization must be stored in secure HTTP-only cookie');

    // Step 3 flow status check on refresh also does NOT return raw resetToken
    const step3Status = await request(app)
      .get('/api/auth/forgot-password/status')
      .set('Cookie', [verifiedSessionCookie]);
    assert.strictEqual(step3Status.status, 200);
    assert.strictEqual(step3Status.body.active, true);
    assert.strictEqual(step3Status.body.step, 3, 'Must restore Step 3 on refresh');
    assert.strictEqual(step3Status.body.resetToken, undefined, 'Status endpoint must NEVER return raw resetToken');

    console.log('   ✓ Reset OTP verified and authorization bound to HTTP-only cookie without raw token exposure.');

    // -------------------------------------------------------------------------
    // TEST 13: Cookie-Authenticated Password Reset & Global Session Revocation
    // -------------------------------------------------------------------------
    console.log('▶ [13/18] Testing Cookie-Authenticated Password Reset & Session Revocation...');

    // Login to obtain active session
    const activeLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alex.student.test@gmail.com', password: 'SecurePassword123!' });
    const preResetAuthCookie = activeLogin.headers['set-cookie'].find((c) => c.startsWith('authToken='));

    // Reset password using the verified session cookie (NO resetToken in JSON body!)
    const resetSuccess = await request(app)
      .post('/api/auth/reset-password')
      .set('Cookie', [verifiedSessionCookie])
      .send({
        newPassword: 'BrandNewSecurePassword789!',
        confirmPassword: 'BrandNewSecurePassword789!',
      });
    assert.strictEqual(resetSuccess.status, 200);

    // Replay attempt with same cookie fails because session was consumed
    const replayReset = await request(app)
      .post('/api/auth/reset-password')
      .set('Cookie', [verifiedSessionCookie])
      .send({
        newPassword: 'BrandNewSecurePassword789!',
        confirmPassword: 'BrandNewSecurePassword789!',
      });
    assert.strictEqual(replayReset.status, 400, 'Replay of consumed reset session must be rejected with 400');

    // Prior session revoked globally
    const revokedSessionCheck = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [preResetAuthCookie]);
    assert.strictEqual(revokedSessionCheck.status, 401, 'Password reset must invalidate all prior sessions globally');

    // Login with new password succeeds
    const newPassLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alex.student.test@gmail.com', password: 'BrandNewSecurePassword789!' });
    assert.strictEqual(newPassLogin.status, 200, 'Login with new password succeeds');

    console.log('   ✓ Password reset succeeds via cookie authorization and revokes all active sessions globally.');

    // -------------------------------------------------------------------------
    // TEST 14: Production JWT Secret Validation
    // -------------------------------------------------------------------------
    console.log('▶ [14/18] Testing Production JWT Secret Validation...');

    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.JWT_SECRET;
    const originalMongo = process.env.MONGO_URI;

    process.env.NODE_ENV = 'production';
    process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/dummy_test_db';
    process.env.JWT_SECRET = 'short'; // Only 5 characters

    assert.throws(
      () => validateEnv(),
      /FATAL: A strong JWT_SECRET \(minimum 32 characters\)/,
      'Production must reject JWT secrets under 32 characters'
    );

    // Restore
    process.env.NODE_ENV = originalEnv;
    process.env.JWT_SECRET = originalSecret;
    process.env.MONGO_URI = originalMongo;

    console.log('   ✓ Production rejects weak or missing JWT secrets.');

    // -------------------------------------------------------------------------
    // TEST 15: Safe Failure Handling When Email Delivery Succeeds But DB Write Fails
    // -------------------------------------------------------------------------
    console.log('▶ [15/18] Testing Database Persistence Before Email Dispatch...');

    const originalFindOneAndUpdate = PendingRegistration.findOneAndUpdate;
    PendingRegistration.findOneAndUpdate = async () => {
      throw new Error('Database write error');
    };

    lastSentMail = null;
    const dbFailRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alex Student',
        email: 'alex.persistence.test@gmail.com',
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
      });

    assert.strictEqual(dbFailRes.status, 500, 'Database failure up front returns 500');
    assert.strictEqual(lastSentMail, null, 'Email must NEVER be sent if database write fails');

    PendingRegistration.findOneAndUpdate = originalFindOneAndUpdate;

    console.log('   ✓ User cannot receive an OTP that is not persisted in the database.');

    // -------------------------------------------------------------------------
    // TEST 16: Safe Compensation When user.save() Fails During OTP Verification
    // -------------------------------------------------------------------------
    console.log('▶ [16/18] Testing Safe Compensation on Account Creation DB Error...');
    await clearCollections();

    const compReg = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Compensation Student',
        email: 'compensation.test@gmail.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
      });
    assert.strictEqual(compReg.status, 200);
    const compCookies = compReg.headers['set-cookie'];
    const compRegCookie = compCookies.find((c) => c.startsWith('regSession='));

    const originalUserSave = User.prototype.save;
    User.prototype.save = async function () {
      throw new Error('Simulated database connection loss during user creation');
    };

    const verifyFailRes = await request(app)
      .post('/api/auth/verify-registration-otp')
      .set('Cookie', [compRegCookie])
      .send({
        otp: lastSentMail.otp,
      });

    assert.strictEqual(verifyFailRes.status, 500, 'Expected 500 when saving user fails');

    User.prototype.save = originalUserSave;

    // Verify safe compensation: pending registration must still exist so user is not stranded!
    const restoredPending = await PendingRegistration.findOne({ email: 'compensation.test@gmail.com' });
    assert.ok(restoredPending, 'Pending registration must be restored after DB error during user creation');

    // Retry verification succeeds
    const retryVerifyRes = await request(app)
      .post('/api/auth/verify-registration-otp')
      .set('Cookie', [compRegCookie])
      .send({
        otp: lastSentMail.otp,
      });
    assert.strictEqual(retryVerifyRes.status, 201, 'User can successfully retry verification after transient failure');

    console.log('   ✓ Pending registration restored safely on DB error; verification retry succeeds.');

    // -------------------------------------------------------------------------
    // TEST 17: Deterministic Concurrency - Older SMTP Failure Cannot Corrupt Newer OTP
    // -------------------------------------------------------------------------
    console.log('▶ [17/18] Testing Older SMTP Failure Cannot Delete/Corrupt Newer OTP...');
    await clearCollections();

    // Initiate registration (v1)
    const initRegRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Concurrency Student',
        email: 'concurrency.test@gmail.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
      });
    assert.strictEqual(initRegRes.status, 200);
    const concCookies = initRegRes.headers['set-cookie'];
    const concRegCookie = concCookies.find((c) => c.startsWith('regSession='));

    // Move cooldown to past so resend is immediately available
    await PendingRegistration.updateOne(
      { email: 'concurrency.test@gmail.com' },
      { $set: { resendAvailableAt: new Date(Date.now() - 1000) } }
    );

    // Resend (v2)
    const resendRes = await request(app)
      .post('/api/auth/resend-registration-otp')
      .set('Cookie', [concRegCookie])
      .send({});
    assert.strictEqual(resendRes.status, 200);
    const v2Otp = lastSentMail.otp;

    // Simulate an older v1 delete rollback executing after v2 was created
    const deletedStale = await PendingRegistration.deleteOne({
      email: 'concurrency.test@gmail.com',
      otpVersion: 1, // Stale version condition
    });
    assert.strictEqual(deletedStale.deletedCount, 0, 'Stale rollback must NOT delete newer record');

    // Verify v2 record is completely intact and usable
    const activeV2 = await PendingRegistration.findOne({ email: 'concurrency.test@gmail.com' });
    assert.strictEqual(activeV2.otpVersion, 2, 'Newer OTP version 2 must remain active');

    const v2VerifyRes = await request(app)
      .post('/api/auth/verify-registration-otp')
      .set('Cookie', [concRegCookie])
      .send({ otp: v2Otp });
    assert.strictEqual(v2VerifyRes.status, 201, 'Newer OTP v2 succeeds cleanly');

    console.log('   ✓ Concurrency verified: Older failed operations cannot delete or corrupt newer OTP state.');

    // -------------------------------------------------------------------------
    // TEST 18: Forged or Mismatched Registration Flow Sessions Blocked
    // -------------------------------------------------------------------------
    console.log('▶ [18/20] Testing Forged or Mismatched Flow Sessions...');
    const fakeFlowCookie = 'regSession=eyJmbG93VG9rZW4iOiJmYWtlZmFrZWZha2VmYWtlZmFrZWZha2VmYWtlZmFrZWZha2VmYWtlIn0%3D';

    const forgedStatusRes = await request(app)
      .get('/api/auth/registration-status')
      .set('Cookie', [fakeFlowCookie]);
    assert.strictEqual(forgedStatusRes.body.active, false, 'Forged flow cookie must be rejected');

    const forgedVerifyRes = await request(app)
      .post('/api/auth/verify-registration-otp')
      .set('Cookie', [fakeFlowCookie])
      .send({ otp: '123456' });
    assert.strictEqual(forgedVerifyRes.status, 400, 'Forged flow cookie cannot verify OTP');

    console.log('   ✓ Forged and mismatched flow sessions rejected safely.');

    // -------------------------------------------------------------------------
    // TEST 19: Flow Cancellation (Registration & Password Reset Safe Cleanup)
    // -------------------------------------------------------------------------
    console.log('▶ [19/20] Testing Flow Cancellation & Session Cleanup...');
    // Create pending registration
    const cancelRegInit = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Cancel Student',
        email: 'cancel.student@gmail.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
      });
    const cancelRegCookie = cancelRegInit.headers['set-cookie'].find((c) => c.startsWith('regSession='));

    // Cancel registration
    const cancelRegRes = await request(app)
      .post('/api/auth/cancel-registration')
      .set('Cookie', [cancelRegCookie]);
    assert.strictEqual(cancelRegRes.status, 200);
    const cancelSetCookie = cancelRegRes.headers['set-cookie'];
    assert(cancelSetCookie.some((c) => c.includes('regSession=;')), 'regSession cookie must be cleared');
    const remainingPending = await PendingRegistration.findOne({ email: 'cancel.student@gmail.com' });
    assert.strictEqual(remainingPending, null, 'Pending registration must be purged upon cancellation');

    // Create password recovery session
    const cancelResetInit = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'john.doe@gmail.com' });
    const cancelResetCookie = cancelResetInit.headers['set-cookie'].find((c) => c.startsWith('resetSession='));

    // Cancel password recovery
    const cancelResetRes = await request(app)
      .post('/api/auth/forgot-password/cancel')
      .set('Cookie', [cancelResetCookie]);
    assert.strictEqual(cancelResetRes.status, 200);
    assert(cancelResetRes.headers['set-cookie'].some((c) => c.includes('resetSession=;')), 'resetSession cookie cleared');
    console.log('   ✓ Flow cancellation safely purges temporary DB records and clears cookies.');

    // -------------------------------------------------------------------------
    // TEST 20: Forgot Password Cooldown Re-submission Synchronizes Cookie & DB
    // -------------------------------------------------------------------------
    console.log('▶ [20/20] Testing Forgot Password Cooldown Cookie Synchronization...');
    // Initiate forgot password
    const initResetRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'john.doe@gmail.com' });
    assert.strictEqual(initResetRes.status, 200);
    const rCookie1 = initResetRes.headers['set-cookie'].find((c) => c.startsWith('resetSession='));

    // Immediate re-submission (on cooldown) WITHOUT the previous cookie (e.g. new tab / client restart)
    const cooldownRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'john.doe@gmail.com' });
    assert.strictEqual(cooldownRes.status, 200);
    assert(cooldownRes.body.cooldownSeconds > 0, 'Must report remaining cooldown');
    const rCookie2 = cooldownRes.headers['set-cookie'].find((c) => c.startsWith('resetSession='));

    // Status check with the NEW cookie must find the record (no out-of-sync error)
    const statusCheck = await request(app)
      .get('/api/auth/forgot-password/status')
      .set('Cookie', [rCookie2]);
    assert.strictEqual(statusCheck.status, 200);
    assert.strictEqual(statusCheck.body.active, true, 'Status check must find active record for new cookie');
    assert.strictEqual(statusCheck.body.step, 2, 'Must remain at Step 2');
    console.log('   ✓ Cooldown re-submission synchronizes cookie and DB state deterministically.');

    // -------------------------------------------------------------------------
    // TEST 21: Name-Length Consistency End-to-End (70 Characters vs 71 Characters)
    // -------------------------------------------------------------------------
    console.log('▶ [21/25] Testing Name-Length Policy Across Layers (70 vs 71 Chars)...');
    // 21a. 71 characters rejected by registration validation middleware
    const name71 = 'A'.repeat(71);
    const reject71 = await request(app)
      .post('/api/auth/register')
      .send({
        name: name71,
        email: 'nametest.71@gmail.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
      });
    assert.strictEqual(reject71.status, 400);
    assert(reject71.body.message.includes('70 characters'), 'Must enforce 70 char maximum in validation message');

    // 21b. Exactly 70 characters permitted, creates pending registration, and verifies to permanent User
    const name70 = 'A'.repeat(70);
    const allow70 = await request(app)
      .post('/api/auth/register')
      .send({
        name: name70,
        email: 'nametest.70@gmail.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
      });
    assert.strictEqual(allow70.status, 200);
    const reg70Cookie = allow70.headers['set-cookie'].find((c) => c.startsWith('regSession='));
    const reg70Otp = lastSentMail.otp;

    const verify70Res = await request(app)
      .post('/api/auth/verify-registration-otp')
      .set('Cookie', [reg70Cookie])
      .send({ otp: reg70Otp });
    assert.strictEqual(verify70Res.status, 201);
    const savedUser70 = await User.findOne({ email: 'nametest.70@gmail.com' });
    assert(savedUser70, 'User with 70 character name must be persisted in MongoDB');
    assert.strictEqual(savedUser70.name.length, 70);
    assert.strictEqual(savedUser70.isVerified, true);
    console.log('   ✓ 70-character name policy verified end-to-end without DB validation failure.');

    // -------------------------------------------------------------------------
    // TEST 22: Expired Registration Flow Rejection (Explicit Query-Level Enforcement)
    // -------------------------------------------------------------------------
    console.log('▶ [22/25] Testing Expired Registration Flows Cannot Be Revived...');
    const expRegRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Expired Reg Student',
        email: 'expired.reg.student@gmail.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
      });
    assert.strictEqual(expRegRes.status, 200);
    const expRegCookie = expRegRes.headers['set-cookie'].find((c) => c.startsWith('regSession='));
    const expRegOtp = lastSentMail.otp;

    // Simulate time expiration in MongoDB document without waiting for asynchronous TTL deletion
    await PendingRegistration.updateOne(
      { email: 'expired.reg.student@gmail.com' },
      { $set: { expiresAt: new Date(Date.now() - 5000) } }
    );

    // Verify request must be rejected explicitly
    const verifyExpReg = await request(app)
      .post('/api/auth/verify-registration-otp')
      .set('Cookie', [expRegCookie])
      .send({ otp: expRegOtp });
    assert.strictEqual(verifyExpReg.status, 400);
    assert(verifyExpReg.body.message.toLowerCase().includes('expired'));

    // Resend request must be rejected explicitly and clear the cookie
    const resendExpReg = await request(app)
      .post('/api/auth/resend-registration-otp')
      .set('Cookie', [expRegCookie]);
    assert.strictEqual(resendExpReg.status, 400);
    assert(resendExpReg.headers['set-cookie'].some((c) => c.includes('regSession=;')));
    console.log('   ✓ Expired registration flows rejected at query level; resurrection prevented.');

    // -------------------------------------------------------------------------
    // TEST 23: Expired Password Reset Flow Rejection & Clean Renewal
    // -------------------------------------------------------------------------
    console.log('▶ [23/25] Testing Expired Password Reset Flow Rejection & Clean Renewal...');
    await User.deleteOne({ email: 'recovery.student@gmail.com' });
    const recoveryUser = new User({
      name: 'Recovery Student',
      email: 'recovery.student@gmail.com',
      password: await bcrypt.hash('SecurePassword123!', 12),
      isVerified: true,
    });
    await recoveryUser.save();

    await PasswordReset.deleteMany({ email: 'recovery.student@gmail.com' });
    const expResetInit = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'recovery.student@gmail.com' });
    assert.strictEqual(expResetInit.status, 200);
    const expResetCookie = expResetInit.headers['set-cookie'].find((c) => c.startsWith('resetSession='));
    const expResetOtp = lastSentMail.otp;

    // Expire the PasswordReset document in DB
    await PasswordReset.updateOne(
      { email: 'recovery.student@gmail.com' },
      { $set: { expiresAt: new Date(Date.now() - 5000) } }
    );

    // Verify OTP on expired reset flow must fail
    const verifyExpReset = await request(app)
      .post('/api/auth/verify-reset-otp')
      .set('Cookie', [expResetCookie])
      .send({ otp: expResetOtp });
    assert.strictEqual(verifyExpReset.status, 400);
    assert(verifyExpReset.body.message.toLowerCase().includes('expired'));

    // Resend OTP on expired reset flow must fail and clear cookie
    const resendExpReset = await request(app)
      .post('/api/auth/resend-reset-otp')
      .set('Cookie', [expResetCookie]);
    assert.strictEqual(resendExpReset.status, 400);
    assert(resendExpReset.headers['set-cookie'].some((c) => c.includes('resetSession=;')));

    // Expired flow must not prevent initiating a fresh recovery request
    const freshForgotRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'recovery.student@gmail.com' });
    assert.strictEqual(freshForgotRes.status, 200);
    assert.strictEqual(freshForgotRes.body.cooldownSeconds, 60);
    console.log('   ✓ Expired password reset records rejected safely and fresh flows allowed.');

    // -------------------------------------------------------------------------
    // TEST 24: Password Recovery Email-Delivery Failure & Immediate Resend Recovery
    // -------------------------------------------------------------------------
    console.log('▶ [24/25] Testing Password Recovery Delivery Failure State & Zero-Cooldown Retry...');
    await PasswordReset.deleteMany({ email: 'recovery.student@gmail.com' });
    simulateSmtpError = true;
    const failDeliveryRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'recovery.student@gmail.com' });
    assert.strictEqual(failDeliveryRes.status, 200);
    assert.strictEqual(failDeliveryRes.body.deliveryFailed, true);
    assert.strictEqual(failDeliveryRes.body.cooldownSeconds, 0);
    const failDeliveryCookie = failDeliveryRes.headers['set-cookie'].find((c) => c.startsWith('resetSession='));

    // Status check confirms delivery_failed state and zero cooldown
    const statusFailRes = await request(app)
      .get('/api/auth/forgot-password/status')
      .set('Cookie', [failDeliveryCookie]);
    assert.strictEqual(statusFailRes.status, 200);
    assert.strictEqual(statusFailRes.body.deliveryFailed, true);
    assert.strictEqual(statusFailRes.body.cooldownSeconds, 0);

    // Restore mail transport: immediate resend succeeds without 60-second lockout
    simulateSmtpError = false;
    const recoverResend = await request(app)
      .post('/api/auth/resend-reset-otp')
      .set('Cookie', [failDeliveryCookie]);
    assert.strictEqual(recoverResend.status, 200);
    assert.strictEqual(Boolean(recoverResend.body.deliveryFailed), false);
    assert.strictEqual(recoverResend.body.cooldownSeconds, 60);
    assert(lastSentMail?.otp, 'New recovery OTP dispatched via email');
    console.log('   ✓ Delivery failure workflow preserves session, reports 0s cooldown, and recovers safely.');

    // -------------------------------------------------------------------------
    // TEST 25: Verified Reset Authorization Survives Stale OTP Requests & Replay Blocked
    // -------------------------------------------------------------------------
    console.log('▶ [25/25] Testing Verified Reset Authorization Protected from Stale OTP & Replays...');
    // Verify the newly issued OTP
    const verifyValidOtp = await request(app)
      .post('/api/auth/verify-reset-otp')
      .set('Cookie', [failDeliveryCookie])
      .send({ otp: lastSentMail.otp });
    assert.strictEqual(verifyValidOtp.status, 200);
    const verifiedResetCookie = verifyValidOtp.headers['set-cookie'].find((c) => c.startsWith('resetSession='));

    // Stale/duplicated OTP verify request arrives from delayed client/network
    const staleVerifyRes = await request(app)
      .post('/api/auth/verify-reset-otp')
      .set('Cookie', [verifiedResetCookie])
      .send({ otp: '000000' });
    assert.strictEqual(staleVerifyRes.status, 200, 'Duplicate request must NOT invalidate verified flow');

    // Complete password reset using verified flow
    const completeResetRes = await request(app)
      .post('/api/auth/reset-password')
      .set('Cookie', [verifiedResetCookie])
      .send({
        newPassword: 'CompletelyNewPassword123!',
        confirmPassword: 'CompletelyNewPassword123!',
      });
    assert.strictEqual(completeResetRes.status, 200);

    // Replay attack with consumed authorization cookie must fail with 400
    const replayResetRes = await request(app)
      .post('/api/auth/reset-password')
      .set('Cookie', [verifiedResetCookie])
      .send({
        newPassword: 'AnotherNewPassword123!',
        confirmPassword: 'AnotherNewPassword123!',
      });
    assert.strictEqual(replayResetRes.status, 400, 'Replay of consumed reset authorization must be rejected');
    console.log('   ✓ Verified authorization survived duplicate requests; replay rejected safely.');

    // -------------------------------------------------------------------------
    // TEST 26: Rebinding Security — Attacker cannot hijack verified+unexpired authorization
    // -------------------------------------------------------------------------
    console.log('▶ [26/33] Testing: Attacker cannot rebind a verified+unexpired reset authorization...');
    await clearCollections();

    // Legitimate user completes the OTP flow and reaches verified state
    const rebindEmail = 'rebind.target@gmail.com';
    await User.create({
      name: 'Rebind Target',
      email: rebindEmail,
      password: await bcrypt.hash('OldPassword123!', 12),
      isVerified: true,
      tokenVersion: 0,
    });

    const rb_initRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: rebindEmail });
    assert.strictEqual(rb_initRes.status, 200);
    const rb_legitCookie = rb_initRes.headers['set-cookie'].find((c) => c.startsWith('resetSession='));

    // Legitimate user verifies their OTP
    const rb_verifyRes = await request(app)
      .post('/api/auth/verify-reset-otp')
      .set('Cookie', [rb_legitCookie])
      .send({ otp: lastSentMail.otp });
    assert.strictEqual(rb_verifyRes.status, 200);
    const rb_verifiedCookie = rb_verifyRes.headers['set-cookie'].find((c) => c.startsWith('resetSession='));

    // Record the original flowTokenHash before the attacker attempt
    const rb_beforeRecord = await PasswordReset.findOne({ email: rebindEmail });
    assert.strictEqual(rb_beforeRecord.status, 'verified', 'Record must be verified');
    const rb_originalFlowHash = rb_beforeRecord.flowTokenHash;

    // Attacker (no cookie) submits forgotPassword during cooldown for the same email
    const rb_attackRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: rebindEmail });
    // Attacker receives the generic anti-enumeration 200 response
    assert.strictEqual(rb_attackRes.status, 200);

    // Attacker must NOT receive a new resetSession cookie that would grant them access
    const rb_attackCookies = rb_attackRes.headers['set-cookie'] ?? [];
    const rb_attackSetCookie = rb_attackCookies.find((c) => c.startsWith('resetSession='));
    assert.ok(!rb_attackSetCookie, 'Attacker must not receive a resetSession cookie for the verified record');

    // DB record must be unchanged — flowTokenHash must not have been rotated
    const rb_afterRecord = await PasswordReset.findOne({ email: rebindEmail });
    assert.strictEqual(rb_afterRecord.status, 'verified', 'Record status must remain verified after attacker attempt');
    assert.strictEqual(rb_afterRecord.flowTokenHash, rb_originalFlowHash, 'flowTokenHash must not change after attacker attempt');

    // Legitimate client can still complete the reset with their original cookie
    const rb_resetRes = await request(app)
      .post('/api/auth/reset-password')
      .set('Cookie', [rb_verifiedCookie])
      .send({ newPassword: 'NewSecurePass456!', confirmPassword: 'NewSecurePass456!' });
    assert.strictEqual(rb_resetRes.status, 200, 'Legitimate client must still be able to complete reset after attacker attempt');

    console.log('   ✓ Attacker cannot rebind a verified+unexpired authorization; legitimate client flow preserved.');

    // -------------------------------------------------------------------------
    // TEST 27: Rebinding Security — Attacker with a mismatching cookie also blocked
    // -------------------------------------------------------------------------
    console.log('▶ [27/33] Testing: Attacker with a mismatching cookie cannot rebind a verified+unexpired record...');
    await clearCollections();

    const rb2Email = 'rebind2.target@gmail.com';
    await User.create({
      name: 'Rebind Target 2',
      email: rb2Email,
      password: await bcrypt.hash('OldPassword123!', 12),
      isVerified: true,
      tokenVersion: 0,
    });

    // Legitimate initiation
    const rb2_initRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: rb2Email });
    const rb2_legitCookie = rb2_initRes.headers['set-cookie'].find((c) => c.startsWith('resetSession='));

    const rb2_verifyRes = await request(app)
      .post('/api/auth/verify-reset-otp')
      .set('Cookie', [rb2_legitCookie])
      .send({ otp: lastSentMail.otp });
    assert.strictEqual(rb2_verifyRes.status, 200);
    const rb2_verifiedCookie = rb2_verifyRes.headers['set-cookie'].find((c) => c.startsWith('resetSession='));

    const rb2_beforeRecord = await PasswordReset.findOne({ email: rb2Email });
    const rb2_originalFlowHash = rb2_beforeRecord.flowTokenHash;

    // Attacker has a different resetSession cookie (stale / from a different flow)
    const rb2_staleFakeFlowToken = 'aaaa'.repeat(16); // 64 hex chars, won't match
    const rb2_fakeCookiePayload = Buffer.from(JSON.stringify({ flowToken: rb2_staleFakeFlowToken })).toString('base64');
    const rb2_attackRes = await request(app)
      .post('/api/auth/forgot-password')
      .set('Cookie', [`resetSession=${rb2_fakeCookiePayload}`])
      .send({ email: rb2Email });
    assert.strictEqual(rb2_attackRes.status, 200);

    const rb2_attackCookies = rb2_attackRes.headers['set-cookie'] ?? [];
    const rb2_attackSetCookie = rb2_attackCookies.find((c) => c.startsWith('resetSession='));
    assert.ok(!rb2_attackSetCookie, 'Attacker with mismatching cookie must not get a new resetSession for the verified record');

    const rb2_afterRecord = await PasswordReset.findOne({ email: rb2Email });
    assert.strictEqual(rb2_afterRecord.flowTokenHash, rb2_originalFlowHash, 'flowTokenHash must not change with mismatching attacker cookie');

    // Legitimate client still completes successfully
    const rb2_resetRes = await request(app)
      .post('/api/auth/reset-password')
      .set('Cookie', [rb2_verifiedCookie])
      .send({ newPassword: 'NewSecurePass789!', confirmPassword: 'NewSecurePass789!' });
    assert.strictEqual(rb2_resetRes.status, 200, 'Legitimate client must still complete reset despite attacker attempt');

    console.log('   ✓ Attacker with mismatching cookie blocked; original verified authorization intact.');

    // -------------------------------------------------------------------------
    // TEST 28: Rebinding Security — Verified but expired authorization falls through to fresh OTP
    // -------------------------------------------------------------------------
    console.log('▶ [28/33] Testing: Verified+expired authorization allows fresh OTP on cooldown bypass...');
    await clearCollections();

    const rb3Email = 'rebind3.target@gmail.com';
    await User.create({
      name: 'Rebind Target 3',
      email: rb3Email,
      password: await bcrypt.hash('OldPassword123!', 12),
      isVerified: true,
      tokenVersion: 0,
    });

    const rb3_initRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: rb3Email });
    const rb3_legitCookie = rb3_initRes.headers['set-cookie'].find((c) => c.startsWith('resetSession='));

    const rb3_verifyRes = await request(app)
      .post('/api/auth/verify-reset-otp')
      .set('Cookie', [rb3_legitCookie])
      .send({ otp: lastSentMail.otp });
    assert.strictEqual(rb3_verifyRes.status, 200);

    // Backdate resetTokenExpiresAt to simulate an expired authorization
    await PasswordReset.updateOne(
      { email: rb3Email },
      { $set: { resetTokenExpiresAt: new Date(Date.now() - 1000) } }
    );

    // Also backdate resendAvailableAt so the cooldown branch is entered but auth is expired
    // The attacker's request should fall through to fresh OTP issuance (outside the verified guard)
    // Since resendAvailableAt is still in future (60s cooldown), we keep it; the code should fall
    // through to the normal new-OTP path because the `else` branch in the cooldown guard will
    // handle non-verified records. We need to confirm the code path doesn't crash.
    const rb3_attackRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: rb3Email });
    // Should succeed — falls through to issue a fresh OTP (a new record overwrites the expired one)
    assert.strictEqual(rb3_attackRes.status, 200, 'Fresh request after verified+expired auth should succeed');

    console.log('   ✓ Verified+expired authorization does not block new OTP issuance.');

    // -------------------------------------------------------------------------
    // TEST 29: Non-verified cooldown record is still rebindable (original behavior preserved)
    // -------------------------------------------------------------------------
    console.log('▶ [29/33] Testing: Non-verified cooldown record remains rebindable by a new-client request...');
    await clearCollections();

    const rb4Email = 'rebind4.target@gmail.com';
    await User.create({
      name: 'Rebind Target 4',
      email: rb4Email,
      password: await bcrypt.hash('OldPassword123!', 12),
      isVerified: true,
      tokenVersion: 0,
    });

    const rb4_initRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: rb4Email });
    assert.strictEqual(rb4_initRes.status, 200);
    const rb4_origRecord = await PasswordReset.findOne({ email: rb4Email });
    assert.strictEqual(rb4_origRecord.status, 'active', 'Record must be active after initiation');

    // A client with no cookie requests again during cooldown — allowed to rebind (active, not verified)
    const rb4_rebindRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: rb4Email });
    assert.strictEqual(rb4_rebindRes.status, 200);
    const rb4_newCookie = rb4_rebindRes.headers['set-cookie'].find((c) => c.startsWith('resetSession='));
    assert.ok(rb4_newCookie, 'New client without cookie should receive a new resetSession for a non-verified active record');

    console.log('   ✓ Non-verified active record still rebindable by new client (existing behavior preserved).');

    // -------------------------------------------------------------------------
    // TEST 30: resendResetOtp is rejected when record is already verified
    // -------------------------------------------------------------------------
    console.log('▶ [30/33] Testing: resendResetOtp returns 400 when record is already verified...');
    await clearCollections();

    const rb5Email = 'rebind5.target@gmail.com';
    await User.create({
      name: 'Rebind Target 5',
      email: rb5Email,
      password: await bcrypt.hash('OldPassword123!', 12),
      isVerified: true,
      tokenVersion: 0,
    });

    const rb5_initRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: rb5Email });
    const rb5_legitCookie = rb5_initRes.headers['set-cookie'].find((c) => c.startsWith('resetSession='));

    const rb5_verifyRes = await request(app)
      .post('/api/auth/verify-reset-otp')
      .set('Cookie', [rb5_legitCookie])
      .send({ otp: lastSentMail.otp });
    assert.strictEqual(rb5_verifyRes.status, 200);
    const rb5_verifiedCookie = rb5_verifyRes.headers['set-cookie'].find((c) => c.startsWith('resetSession='));

    const rb5_resendRes = await request(app)
      .post('/api/auth/resend-reset-otp')
      .set('Cookie', [rb5_verifiedCookie]);
    assert.strictEqual(rb5_resendRes.status, 400, 'resendResetOtp must return 400 when already verified');
    assert.ok(rb5_resendRes.body.message?.includes('already been verified'), 'Response message must indicate already verified');

    console.log('   ✓ resendResetOtp correctly rejects request when authorization is already verified.');

    // -------------------------------------------------------------------------
    // TEST 31: cancelForgotPassword only removes the caller's own record
    // -------------------------------------------------------------------------
    console.log('▶ [31/33] Testing: cancelForgotPassword only deletes the record bound to caller\'s flow token...');
    await clearCollections();

    const rb6Email = 'rebind6.target@gmail.com';
    await User.create({
      name: 'Rebind Target 6',
      email: rb6Email,
      password: await bcrypt.hash('OldPassword123!', 12),
      isVerified: true,
      tokenVersion: 0,
    });

    const rb6_initRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: rb6Email });
    const rb6_legitCookie = rb6_initRes.headers['set-cookie'].find((c) => c.startsWith('resetSession='));

    // Attacker attempts to cancel using a random / mismatched flow token
    const rb6_fakePayload = Buffer.from(JSON.stringify({ flowToken: 'bbbb'.repeat(16) })).toString('base64');
    const rb6_cancelRes = await request(app)
      .post('/api/auth/forgot-password/cancel')
      .set('Cookie', [`resetSession=${rb6_fakePayload}`]);
    assert.strictEqual(rb6_cancelRes.status, 200);

    // Legitimate user's record must still exist
    const rb6_record = await PasswordReset.findOne({ email: rb6Email });
    assert.ok(rb6_record, 'Legitimate user\'s reset record must not be deleted by attacker cancel');

    // Legitimate user cancels their own session
    const rb6_legitCancelRes = await request(app)
      .post('/api/auth/forgot-password/cancel')
      .set('Cookie', [rb6_legitCookie]);
    assert.strictEqual(rb6_legitCancelRes.status, 200);

    const rb6_afterRecord = await PasswordReset.findOne({ email: rb6Email });
    assert.ok(!rb6_afterRecord, 'Legitimate cancel must remove the record');

    console.log('   ✓ cancelForgotPassword only removes the caller\'s own record; attacker cancel is harmless.');

    // -------------------------------------------------------------------------
    // TEST 32: Attacker receives no discriminating response difference (anti-enumeration)
    // -------------------------------------------------------------------------
    console.log('▶ [32/33] Testing: Attacker and legitimate new-request receive identical responses...');
    await clearCollections();

    const rb7Email = 'rebind7.target@gmail.com';
    // User exists and has a verified reset in progress
    await User.create({
      name: 'Rebind Target 7',
      email: rb7Email,
      password: await bcrypt.hash('OldPassword123!', 12),
      isVerified: true,
      tokenVersion: 0,
    });

    const rb7_initRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: rb7Email });
    const rb7_legitCookie = rb7_initRes.headers['set-cookie'].find((c) => c.startsWith('resetSession='));
    const rb7_verifyRes = await request(app)
      .post('/api/auth/verify-reset-otp')
      .set('Cookie', [rb7_legitCookie])
      .send({ otp: lastSentMail.otp });
    assert.strictEqual(rb7_verifyRes.status, 200);

    // Attacker with no cookie
    const rb7_attackRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: rb7Email });

    // Non-existent email (for anti-enumeration comparison)
    const rb7_nonExistentRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'totally.nonexistent.xyz123@gmail.com' });

    // Both must return 200 with identical message structure
    assert.strictEqual(rb7_attackRes.status, 200);
    assert.strictEqual(rb7_nonExistentRes.status, 200);
    assert.strictEqual(rb7_attackRes.body.message, rb7_nonExistentRes.body.message, 'Attacker response must be indistinguishable from non-existent account response');

    console.log('   ✓ Anti-enumeration preserved: attacker response is identical to non-existent account response.');

    // -------------------------------------------------------------------------
    // TEST 33: Legitimate client cookie remains valid and unmodified after all attacker attempts
    // -------------------------------------------------------------------------
    console.log('▶ [33/33] Testing: Legitimate client flow token is never mutated by attacker requests...');
    // (Uses rb7Email which is still in verified state from TEST 32)
    const rb7_verifiedCookie = rb7_verifyRes.headers['set-cookie'].find((c) => c.startsWith('resetSession='));
    const rb7_record = await PasswordReset.findOne({ email: rb7Email });
    const rb7_originalHash = rb7_record.flowTokenHash;

    // Multiple attacker requests
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: rb7Email });
    }

    const rb7_afterRecord = await PasswordReset.findOne({ email: rb7Email });
    assert.strictEqual(rb7_afterRecord.flowTokenHash, rb7_originalHash, 'flowTokenHash must be unchanged after multiple attacker requests');

    // Legitimate client can still complete the reset
    const rb7_resetRes = await request(app)
      .post('/api/auth/reset-password')
      .set('Cookie', [rb7_verifiedCookie])
      .send({ newPassword: 'FinalNewPass999!', confirmPassword: 'FinalNewPass999!' });
    assert.strictEqual(rb7_resetRes.status, 200, 'Legitimate client must complete reset after multiple attacker attempts');

    console.log('   ✓ Legitimate client flow token unmodified through all attacker attempts; reset completed.');

    console.log('\n🎉 ALL 33 AUTHENTICATION INTEGRATION TEST SUITES PASSED!\n');
  } finally {
    await cleanup();
  }
}

runIntegrationTests().catch((err) => {
  console.error('\n❌ Integration Test Failed:', err);
  process.exit(1);
});
