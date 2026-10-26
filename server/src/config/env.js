import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  mongoUri: process.env.MONGO_URI || '',
  jwtSecret: process.env.JWT_SECRET || 'dev_fallback_secret_change_in_production_min32chars',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  cookieSameSite: process.env.COOKIE_SAME_SITE || (process.env.NODE_ENV === 'production' ? 'none' : 'lax'),
  cookieSecure: process.env.COOKIE_SECURE !== undefined
    ? process.env.COOKIE_SECURE === 'true'
    : (process.env.NODE_ENV === 'production'),
  trustProxy: (() => {
    if (process.env.TRUST_PROXY !== undefined) {
      const val = process.env.TRUST_PROXY.trim().toLowerCase();
      if (val === 'true') return true;
      if (val === 'false') return false;
      const num = parseInt(val, 10);
      return isNaN(num) ? process.env.TRUST_PROXY : num;
    }
    return process.env.NODE_ENV === 'production' ? 1 : false;
  })(),
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT, 10) || 465,
    secure: process.env.SMTP_SECURE !== undefined
      ? process.env.SMTP_SECURE === 'true'
      : (parseInt(process.env.SMTP_PORT, 10) || 465) === 465,
    requireTLS: process.env.SMTP_REQUIRE_TLS !== undefined
      ? process.env.SMTP_REQUIRE_TLS === 'true'
      : (parseInt(process.env.SMTP_PORT, 10) || 465) === 587,
    family: parseInt(process.env.SMTP_FAMILY, 10) || 4, // Default to IPv4 to prevent IPv6 routing blackholes in containers
    connectionTimeout: parseInt(process.env.SMTP_CONNECTION_TIMEOUT, 10) || 10000,
    greetingTimeout: parseInt(process.env.SMTP_GREETING_TIMEOUT, 10) || 10000,
    socketTimeout: parseInt(process.env.SMTP_SOCKET_TIMEOUT, 10) || 15000,
    user: (process.env.EMAIL_USER || process.env.SMTP_USER || '').trim(),
    appPassword: (
      process.env.EMAIL_APP_PASSWORD ||
      process.env.EMAIL_PASS ||
      process.env.SMTP_PASS ||
      process.env.SMTP_PASSWORD ||
      ''
    ).replace(/\s+/g, '').trim(),
  },
};

const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'your_jwt_super_secret_key_change_in_production_min_32_chars',
  'dev_fallback_secret_change_in_production_min32chars',
  'super_secret_production_key_minimum_32_characters_long_for_security!',
  'your_secret_key_here_change_in_production_12345',
  'replace_this_with_a_secure_random_key_in_production',
  'change_this_secret_in_production_at_least_32_chars',
]);

export const isWeakOrPlaceholderSecret = (secret) => {
  if (!secret || typeof secret !== 'string') return true;
  if (secret.length < 32) return true;
  if (KNOWN_PLACEHOLDER_SECRETS.has(secret)) return true;
  if (/change_in_production|example|placeholder|default_secret|test_secret/i.test(secret)) {
    return true;
  }
  // Low entropy check: fewer than 8 unique characters in a 32+ character string
  const uniqueChars = new Set(secret).size;
  if (uniqueChars < 8) return true;
  return false;
};

export const validateEnv = () => {
  const fatalErrors = [];
  const warnings = [];

  const currentEnv = process.env.NODE_ENV || config.nodeEnv;
  const currentMongo = process.env.MONGO_URI || config.mongoUri;
  const currentSecret = process.env.JWT_SECRET || config.jwtSecret;

  // Enforce MongoDB URI presence (except in test mode where an in-memory URI may be injected)
  if (!currentMongo && currentEnv !== 'test') {
    fatalErrors.push('FATAL: MONGO_URI is missing. A valid MongoDB connection string must be configured.');
  }

  // Enforce strong JWT secret in production
  if (currentEnv === 'production') {
    if (!currentSecret || currentSecret.length < 32) {
      fatalErrors.push('FATAL: A strong JWT_SECRET (minimum 32 characters) must be configured in production.');
    } else if (isWeakOrPlaceholderSecret(currentSecret)) {
      fatalErrors.push('FATAL: Production JWT_SECRET is using a known placeholder, weak, or low-entropy example key.');
    }
  }

  if (fatalErrors.length > 0) {
    throw new Error(fatalErrors.join(' | '));
  }

  if (!config.smtp.user || !config.smtp.appPassword) {
    warnings.push('SMTP credentials (EMAIL_USER / EMAIL_APP_PASSWORD / EMAIL_PASS) are not configured. Emails will fail to send until set in environment.');
  } else if (
    config.smtp.user.includes('your-verified-account') ||
    config.smtp.appPassword.includes('your-16-char')
  ) {
    warnings.push('SMTP credentials in environment are using placeholder values (your-verified-account / your-16-char). Real credentials are required for OTP delivery.');
  }

  // Validate SMTP Port & TLS consistency
  if (config.smtp.port === 587 && config.smtp.secure === true) {
    warnings.push('Inconsistent SMTP config: Port 587 uses STARTTLS (SMTP_SECURE=false). Setting SMTP_SECURE=true on port 587 causes immediate connection failure.');
  }
  if (config.smtp.port === 465 && config.smtp.secure === false) {
    warnings.push('Inconsistent SMTP config: Port 465 uses SMTPS/implicit TLS (SMTP_SECURE=true). Setting SMTP_SECURE=false on port 465 causes connection timeouts.');
  }
  if (config.smtp.port === 25) {
    warnings.push('Insecure / blocked SMTP port 25 is configured. Major cloud platforms (including Render) block outbound port 25. Use port 465 (SMTPS) or port 587 (STARTTLS).');
  }

  return warnings;
};
