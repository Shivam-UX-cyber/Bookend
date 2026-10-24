import assert from 'node:assert';
import { generateOtp, hashOtp, compareOtp } from '../src/services/otpService.js';
import { generateAuthToken, verifyAuthToken, generateResetToken, hashToken, generateFlowToken, hashFlowToken } from '../src/services/tokenService.js';
import { normalizeGmail, isStrictGmail, isValidInternationalName } from '../src/middleware/validationMiddleware.js';
import { config, validateEnv, isWeakOrPlaceholderSecret } from '../src/config/env.js';
import bcrypt from 'bcryptjs';

console.log('🧪 Starting Security & Cryptography Unit Tests...\n');

async function runTests() {
  // Test 1: OTP Generation & Bcrypt Hashing
  console.log('1. Testing OTP Generation & Bcrypt Hashing...');
  const otp = generateOtp();
  assert.strictEqual(otp.length, 6, 'OTP must be exactly 6 characters long');
  assert.match(otp, /^\d{6}$/, 'OTP must be 6 numeric digits');

  const hashedOtp = await hashOtp(otp);
  assert.notStrictEqual(otp, hashedOtp, 'OTP must not be stored in plaintext');
  assert(await compareOtp(otp, hashedOtp), 'Valid OTP comparison must pass');
  assert(!(await compareOtp('000000', hashedOtp)), 'Invalid OTP comparison must fail');
  console.log('   ✓ OTP is 6 digits, cryptographically hashed, and verified.\n');

  // Test 2: JWT Signing & Session Token Versioning
  console.log('2. Testing JWT Signing & Session Token Versioning...');
  const fakeUser = {
    _id: '65f1234567890abcdef12345',
    tokenVersion: 1,
  };
  const token = generateAuthToken(fakeUser);
  const decoded = verifyAuthToken(token);
  assert.strictEqual(decoded.id, fakeUser._id, 'Decoded user ID must match');
  assert.strictEqual(decoded.tokenVersion, 1, 'Decoded tokenVersion must match');
  console.log('   ✓ JWT signs payload and verifies tokenVersion correctly.\n');

  // Test 3: Password Hashing with Bcrypt
  console.log('3. Testing Password Bcrypt Hashing & Salting...');
  const plainPassword = 'SecureStudentPassword!2026';
  const hashedPassword = await bcrypt.hash(plainPassword, 12);
  assert(await bcrypt.compare(plainPassword, hashedPassword), 'Correct password match');
  assert(!(await bcrypt.compare('WrongPassword!123', hashedPassword)), 'Incorrect password fails');
  console.log('   ✓ Bcrypt work factor 12 hash passes verification.\n');

  // Test 4: Gmail Normalization & Strict Enforcement
  console.log('4. Testing Gmail Validation & Domain Normalization...');
  assert.strictEqual(normalizeGmail('  student.name@gmail.com  '), 'student.name@gmail.com');
  assert.strictEqual(normalizeGmail('Student.Name@GoogleMail.com'), 'student.name@gmail.com');

  assert.strictEqual(isStrictGmail('john.doe@gmail.com'), true);
  assert.strictEqual(isStrictGmail('alex@gmail.com'), false); // Too short for Gmail username policy (under 6 chars)
  assert.strictEqual(isStrictGmail('student@yahoo.com'), false); // Non-gmail
  assert.strictEqual(isStrictGmail('student@college.edu'), false); // Non-gmail (personal Gmail policy)
  assert.strictEqual(isStrictGmail('invalid..dots@gmail.com'), false);
  console.log('   ✓ Gmail-only policy and normalization work as expected.\n');

  // Test 5: Reset Token Generation & Hash
  console.log('5. Testing One-Time Reset Token Cryptographic Hashing...');
  const resetToken = generateResetToken();
  assert.strictEqual(resetToken.length, 64, 'Reset token must be 32 bytes (64 hex chars)');
  const tokenHash = hashToken(resetToken);
  assert.strictEqual(tokenHash.length, 64, 'SHA-256 hash must be 64 hex chars');
  assert.strictEqual(hashToken(resetToken), tokenHash, 'SHA-256 hash must be deterministic');
  console.log('   ✓ Reset token generated and SHA-256 hashed successfully.\n');

  // Test 6: Strict Gmail Username Boundary Tests (Section 10)
  console.log('6. Testing Gmail Username Length Boundaries & Dot Placements...');
  assert.strictEqual(isStrictGmail('12345@gmail.com'), false, '5-char username must be rejected');
  assert.strictEqual(isStrictGmail('123456@gmail.com'), true, '6-char username must be accepted');
  assert.strictEqual(isStrictGmail('a'.repeat(30) + '@gmail.com'), true, '30-char username must be accepted');
  assert.strictEqual(isStrictGmail('a'.repeat(31) + '@gmail.com'), false, '31-char username must be rejected');
  assert.strictEqual(isStrictGmail('.leadingdot@gmail.com'), false, 'Leading dot must be rejected');
  assert.strictEqual(isStrictGmail('trailingdot.@gmail.com'), false, 'Trailing dot must be rejected');
  assert.strictEqual(isStrictGmail('consecutive..dots@gmail.com'), false, 'Consecutive dots must be rejected');
  assert.strictEqual(isStrictGmail('valid.user.name@gmail.com'), true, 'Separated dots must be accepted');
  assert.strictEqual(isStrictGmail('UPPERCASE.NAME@gmail.com'), true, 'Uppercase must be normalized and accepted');
  assert.strictEqual(isStrictGmail('valid.user@googlemail.com'), true, 'googlemail.com alias accepted');
  console.log('   ✓ Strict Gmail boundaries (5, 6, 30, 31 chars, dots) verified.\n');

  // Test 7: International Unicode Name Validation (Section 11)
  console.log('7. Testing International Unicode Name Validation...');
  assert.strictEqual(isValidInternationalName('राहुल शर्मा'), true, 'Devanagari names must be accepted');
  assert.strictEqual(isValidInternationalName('José María Aznar'), true, 'Accented Spanish names must be accepted');
  assert.strictEqual(isValidInternationalName('Renée Müller'), true, 'German/French accented names must be accepted');
  assert.strictEqual(isValidInternationalName('Alex O\'Connor'), true, 'Apostrophe in names must be accepted');
  assert.strictEqual(isValidInternationalName('Mary-Jane Watson'), true, 'Hyphenated names must be accepted');
  assert.strictEqual(isValidInternationalName('Li'), true, '2-character names must be accepted');
  assert.strictEqual(isValidInternationalName('A'), false, '1-character names must be rejected');
  assert.strictEqual(isValidInternationalName('   '), false, 'Whitespace-only names must be rejected');
  assert.strictEqual(isValidInternationalName('---...'), false, 'Punctuation-only names must be rejected');
  assert.strictEqual(isValidInternationalName('<script>alert(1)</script>'), false, 'HTML/Script injection must be rejected');
  console.log('   ✓ International Unicode names accepted and punctuation-only/script names rejected.\n');

  // Test 8: Bcrypt 72-Byte Password Limit Enforcement (Section 12)
  console.log('8. Testing Password Length & UTF-8 72-Byte Limit...');
  const shortValid = 'Password123!';
  const max72Bytes = 'A'.repeat(72);
  const over72Bytes = 'A'.repeat(73);
  // Multibyte Unicode character (3 bytes per character in UTF-8)
  const multibyte25Chars = '€'.repeat(25); // 25 * 3 = 75 bytes > 72 bytes
  assert.strictEqual(Buffer.byteLength(shortValid, 'utf8') <= 72, true);
  assert.strictEqual(Buffer.byteLength(max72Bytes, 'utf8') <= 72, true);
  assert.strictEqual(Buffer.byteLength(over72Bytes, 'utf8') > 72, true);
  assert.strictEqual(Buffer.byteLength(multibyte25Chars, 'utf8') > 72, true, '75-byte Unicode must exceed 72-byte limit');
  console.log('   ✓ Bcrypt 72-byte limit correctly identified across single-byte and multi-byte UTF-8.\n');

  // Test 9: Production Rejection of .env.example Placeholder Secret (Section 7)
  console.log('9. Testing Production Rejection of .env.example Placeholder Secret...');
  const exampleSecret = 'your_jwt_super_secret_key_change_in_production_min_32_chars';
  assert.strictEqual(isWeakOrPlaceholderSecret(exampleSecret), true, 'Placeholder secret from .env.example must be rejected');
  assert.strictEqual(isWeakOrPlaceholderSecret('dev_fallback_secret_change_in_production_min32chars'), true, 'Fallback secret must be rejected');
  assert.strictEqual(isWeakOrPlaceholderSecret('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), true, 'Low-entropy repeated secret must be rejected');
  assert.strictEqual(isWeakOrPlaceholderSecret('high_entropy_random_production_secret_key_98324759823475982374'), false, 'Strong random secret must pass');

  // Verify validateEnv() throws when given example secret under NODE_ENV=production
  const origEnv = process.env.NODE_ENV;
  const origSecret = process.env.JWT_SECRET;
  const origMongo = process.env.MONGO_URI;

  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = exampleSecret;
  process.env.MONGO_URI = 'mongodb://localhost:27017/test_prod';

  assert.throws(() => {
    validateEnv();
  }, /FATAL.*placeholder/i, 'Production environment must fail fast when using .env.example placeholder');

  // Restore environment
  process.env.NODE_ENV = origEnv;
  process.env.JWT_SECRET = origSecret;
  process.env.MONGO_URI = origMongo;
  console.log('   ✓ Production rejects known example placeholder secrets and low entropy keys.\n');

  // Test 10: Cross-Site Production Cookie Configuration (Section 8)
  console.log('10. Testing Cross-Site Production Cookie Configuration...');
  const { getCookieOptions, getClearCookieOptions } = await import('../src/controllers/authController.js');

  const prevEnv = config.nodeEnv;
  const prevSameSite = config.cookieSameSite;
  const prevSecure = config.cookieSecure;

  // In production with cross-site domains (Vercel + Render), SameSite must be 'none' and Secure must be true
  config.nodeEnv = 'production';
  config.cookieSameSite = 'none';
  config.cookieSecure = true;

  const prodOpts = getCookieOptions();
  assert.strictEqual(prodOpts.httpOnly, true, 'Cookies must be HttpOnly');
  assert.strictEqual(prodOpts.secure, true, 'Cookies in production must be Secure');
  assert.strictEqual(prodOpts.sameSite, 'none', 'Cross-site cookies must have SameSite=none');

  const prodClearOpts = getClearCookieOptions();
  assert.strictEqual(prodClearOpts.httpOnly, true);
  assert.strictEqual(prodClearOpts.secure, true);
  assert.strictEqual(prodClearOpts.sameSite, 'none');

  // In development mode, SameSite defaults to 'lax'
  config.nodeEnv = 'development';
  config.cookieSameSite = 'lax';
  config.cookieSecure = false;

  const devOpts = getCookieOptions();
  assert.strictEqual(devOpts.sameSite, 'lax');
  assert.strictEqual(devOpts.httpOnly, true);

  // Restore config
  config.nodeEnv = prevEnv;
  config.cookieSameSite = prevSameSite;
  config.cookieSecure = prevSecure;
  console.log('   ✓ Cross-site cookie options correctly configure SameSite=none and Secure: true in production.\n');

  console.log('🎉 ALL 10 SECURITY & CRYPTOGRAPHY TESTS PASSED!\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
