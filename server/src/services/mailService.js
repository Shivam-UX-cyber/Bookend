import { Resend } from 'resend';
import { config } from '../config/env.js';

let mailSenderOverride = null;
let resendClientInstance = null;

/**
 * Allows integration tests to intercept or simulate mail delivery
 * @param {Function|null} fn 
 */
export const setMailSenderOverride = (fn) => {
  mailSenderOverride = fn;
};

/**
 * Returns or creates a singleton Resend client instance.
 * @returns {Resend}
 */
export const getResendClient = () => {
  if (!resendClientInstance && config.email?.resendApiKey) {
    resendClientInstance = new Resend(config.email.resendApiKey);
  }
  return resendClientInstance;
};

/**
 * Resets the cached Resend client instance (used for testing env updates).
 */
export const resetResendClient = () => {
  resendClientInstance = null;
};

/**
 * Check if valid Resend API key is configured
 * @returns {boolean}
 */
export const isEmailConfigured = () => {
  const key = config.email?.resendApiKey;
  return Boolean(
    key &&
    typeof key === 'string' &&
    key.length >= 8 &&
    !key.includes('placeholder') &&
    !key.includes('your-resend-api-key') &&
    !key.includes('re_your_api_key')
  );
};

// Backward-compatibility alias
export const isSmtpConfigured = isEmailConfigured;

/**
 * Masks an email address to protect student privacy in server logs.
 * Example: 'shivamkumar785707@gmail.com' -> 's***7@gmail.com'
 * @param {string} email
 * @returns {string}
 */
export const maskEmail = (email) => {
  if (!email || typeof email !== 'string') return '***';
  const parts = email.trim().split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return '***';
  const [local, domain] = parts;
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
};

/**
 * Sanitizes an error message or provider string by removing sensitive patterns:
 * - Resend API keys (re_...)
 * - 6-digit numeric sequences (OTPs)
 * - Continuous alphabetic or hex secrets / passwords
 * - Bearer tokens, passwords, authorization headers
 * @param {string} text
 * @returns {string}
 */
export const sanitizeProviderErrorDetails = (text) => {
  if (!text || typeof text !== 'string') return '';
  return text
    // Redact Resend API keys (e.g. re_123456789_abcdef...)
    .replace(/\bre_[A-Za-z0-9_]{8,}\b/gi, 're_[REDACTED_API_KEY]')
    // Redact 6-digit OTP codes (exact boundary)
    .replace(/\b\d{6}\b/g, '[REDACTED_OTP]')
    // Redact 16-character continuous passwords
    .replace(/\b[a-zA-Z]{16}\b/g, '[REDACTED_PASSWORD]')
    // Redact Bearer tokens
    .replace(/bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED_TOKEN]')
    // Redact password/token/key assignments (e.g. pass=xyz, apiKey=xyz, secret=xyz)
    .replace(/(password|passwd|pass|secret|token|apiKey|api_key|authorization)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]')
    // Redact basic auth header tokens in string
    .replace(/basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [REDACTED_AUTH]');
};

/**
 * Classifies an error into specific failure stages:
 * - 'CONFIGURATION_MISSING': RESEND_API_KEY missing or placeholder
 * - 'DNS_RESOLUTION': Hostname lookup failed
 * - 'NETWORK_FAILURE': HTTPS socket/timeout/fetch error to api.resend.com
 * - 'API_AUTHENTICATION': Invalid or missing Resend API key (HTTP 401)
 * - 'RECIPIENT_RESTRICTION': Resend testing domain restricted to account owner (HTTP 403)
 * - 'PROVIDER_RATE_LIMIT': Resend rate limiting (HTTP 429)
 * - 'RECIPIENT_REJECTION': Provider rejected recipient email (HTTP 422)
 * - 'PROTOCOL_OR_UNKNOWN': Uncategorized protocol or application failure
 * @param {Error|object} err
 * @returns {string}
 */
export const classifyMailErrorStage = (err) => {
  if (!err) return 'UNKNOWN';
  const code = err.code || '';
  const message = err.message || '';
  const statusCode = err.statusCode || err.status || (typeof err.response === 'object' ? err.response?.status : null);
  const name = err.name || '';

  if (code === 'ECONFIG_MISSING' || /not configured|missing.*key/i.test(message)) {
    return 'CONFIGURATION_MISSING';
  }

  if (code === 'ENOTFOUND' || err.syscall === 'getaddrinfo') {
    return 'DNS_RESOLUTION';
  }

  if (
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    /timeout|network error|fetch failed/i.test(message)
  ) {
    return 'NETWORK_FAILURE';
  }

  if (
    statusCode === 401 ||
    code === 'EAUTH' ||
    /api key.*invalid|invalid.*token|unauthorized|missing_api_key/i.test(message) ||
    name === 'invalid_api_key'
  ) {
    return 'API_AUTHENTICATION';
  }

  if (
    statusCode === 403 ||
    /testing emails to your own email address|domain.*not.*verified|restricted/i.test(message)
  ) {
    return 'RECIPIENT_RESTRICTION';
  }

  if (
    statusCode === 429 ||
    /rate limit|quota|too many/i.test(message) ||
    name === 'rate_limit_exceeded'
  ) {
    return 'PROVIDER_RATE_LIMIT';
  }

  if (
    code === 'EREJECTED' ||
    statusCode === 422 ||
    /rejected|invalid.*recipient|invalid.*email|validation_error/i.test(message)
  ) {
    return 'RECIPIENT_REJECTION';
  }

  return 'PROTOCOL_OR_UNKNOWN';
};

/**
 * Safely extracts non-sensitive email diagnostics from an Error or Resend response.
 * Strictly guarantees that API keys, tokens, and 6-digit OTP codes are NEVER logged.
 * @param {string} operation
 * @param {Error|object} err
 * @param {string} [recipientEmail]
 * @returns {object}
 */
export const extractMailDiagnostics = (operation, err, recipientEmail = null) => {
  const errorObj = err || {};
  const rawMessage = errorObj.message || String(errorObj);
  const failureStage = classifyMailErrorStage(errorObj);

  return {
    operation: operation || 'unknownMailOperation',
    provider: 'resend',
    deliveryType: 'https',
    failureStage,
    errorName: errorObj.name || 'Error',
    errorCode: errorObj.code || null,
    statusCode: errorObj.statusCode || errorObj.status || null,
    from: config.email?.from || 'Campus Book Exchange <onboarding@resend.dev>',
    isConfigured: isEmailConfigured(),
    recipient: recipientEmail ? maskEmail(recipientEmail) : null,
    details: sanitizeProviderErrorDetails(rawMessage),
    timestamp: new Date().toISOString(),
  };
};

/**
 * Formats and logs a safe, structured diagnostic message to console.error
 * @param {string} operation
 * @param {Error|object} err
 * @param {string} [recipientEmail]
 * @returns {object}
 */
export const logSafeMailError = (operation, err, recipientEmail = null) => {
  const diagnostic = extractMailDiagnostics(operation, err, recipientEmail);
  console.error('\x1b[31m%s\x1b[0m', `[MailService Error] ${JSON.stringify(diagnostic)}`);
  return diagnostic;
};

/**
 * Logs a safe, structured diagnostic message to console.log on successful mail dispatch
 * @param {string} operation
 * @param {object} info
 * @param {string} [recipientEmail]
 * @returns {object}
 */
export const logSafeMailSuccess = (operation, info, recipientEmail = null) => {
  const logData = {
    operation: operation || 'unknownMailOperation',
    provider: 'resend',
    deliveryType: 'https',
    status: 'accepted',
    messageId: info?.messageId || info?.id || null,
    recipient: recipientEmail ? maskEmail(recipientEmail) : null,
    from: config.email?.from || 'Campus Book Exchange <onboarding@resend.dev>',
    timestamp: new Date().toISOString(),
  };
  console.log('\x1b[32m%s\x1b[0m', `[MailService Success] ${JSON.stringify(logData)}`);
  return logData;
};

/**
 * Tests connectivity and API key validity with Resend HTTPS API.
 * Does not send an email. Returns structured status for diagnostics.
 * @returns {Promise<{ success: boolean, failureStage: string|null, details?: string, errorCode?: string, provider: string }>}
 */
export const verifyEmailConnection = async () => {
  if (mailSenderOverride) {
    try {
      const overrideResult = await mailSenderOverride({ type: 'verify' });
      if (overrideResult && overrideResult.error) {
        throw overrideResult.error;
      }
      return { success: true, failureStage: null, provider: 'resend', mocked: true };
    } catch (overrideErr) {
      const diag = logSafeMailError('verifyEmailConnection', overrideErr);
      return {
        success: false,
        failureStage: diag.failureStage,
        errorCode: diag.errorCode,
        details: diag.details,
        provider: 'resend',
      };
    }
  }

  if (!isEmailConfigured()) {
    return {
      success: false,
      failureStage: 'CONFIGURATION_MISSING',
      details: 'RESEND_API_KEY is missing or placeholder value in environment.',
      provider: 'resend',
    };
  }

  try {
    const resend = new Resend(config.email.resendApiKey);
    const { data, error } = await resend.apiKeys.list();
    if (error) {
      // If error is 403 (restricted sending-only key), HTTPS connectivity and authentication succeeded!
      if (error.statusCode === 403 || /restricted|permission/i.test(error.message)) {
        return {
          success: true,
          failureStage: null,
          details: 'Resend HTTPS API reachable and API key authenticated (restricted sending permission).',
          provider: 'resend',
        };
      }
      const apiErr = new Error(error.message || 'Resend verification failed');
      apiErr.statusCode = error.statusCode;
      apiErr.name = error.name;
      const diag = logSafeMailError('verifyEmailConnection', apiErr);
      return {
        success: false,
        failureStage: diag.failureStage,
        errorCode: error.name || null,
        details: diag.details,
        provider: 'resend',
      };
    }

    return {
      success: true,
      failureStage: null,
      details: 'Resend HTTPS API connected and verified successfully.',
      provider: 'resend',
    };
  } catch (err) {
    const diag = logSafeMailError('verifyEmailConnection', err);
    return {
      success: false,
      failureStage: diag.failureStage,
      errorCode: diag.errorCode,
      details: diag.details,
      provider: 'resend',
    };
  }
};

// Backward-compatibility alias
export const verifySmtpConnection = verifyEmailConnection;

/**
 * Base email layout wrapper
 */
const getHtmlTemplate = ({ title, preheader, bodyContent, footerNote }) => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .container { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { background: linear-gradient(135deg, #1e3a8a, #2563eb); padding: 32px 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
    .header p { margin: 6px 0 0; font-size: 14px; opacity: 0.9; }
    .content { padding: 32px 28px; }
    .otp-box { background: #f1f5f9; border: 2px dashed #93c5fd; border-radius: 8px; text-align: center; padding: 20px; margin: 24px 0; }
    .otp-code { font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #1d4ed8; font-family: monospace; }
    .warning { font-size: 13px; color: #64748b; line-height: 1.6; margin-top: 20px; border-left: 3px solid #f59e0b; padding-left: 12px; }
    .footer { background: #f8fafc; padding: 20px 24px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Campus Book Exchange</h1>
      <p>Secure Student Peer-to-Peer Book Network</p>
    </div>
    <div class="content">
      <span style="display:none;font-size:0;max-height:0;line-height:0;">${preheader}</span>
      ${bodyContent}
    </div>
    <div class="footer">
      <p>${footerNote || 'This is an automated security email from Campus Book Exchange.'}</p>
      <p>&copy; ${new Date().getFullYear()} Campus Book Exchange. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
};

const escapeHtml = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

/**
 * Send 6-digit OTP for Registration Verification via Resend HTTPS API
 * @param {string} toEmail 
 * @param {string} name 
 * @param {string} otp 
 */
export const sendRegistrationOtpEmail = async (toEmail, name, otp) => {
  const operation = 'sendRegistrationOtpEmail';

  if (mailSenderOverride) {
    let overrideResult;
    try {
      overrideResult = await mailSenderOverride({ type: 'registration', to: toEmail, name, otp });
    } catch (overrideErr) {
      logSafeMailError(operation, overrideErr, toEmail);
      throw overrideErr;
    }
    if (overrideResult && Array.isArray(overrideResult.rejected) && overrideResult.rejected.length > 0) {
      const rejectErr = new Error(`Email provider rejected recipient: ${overrideResult.rejected.join(', ')}`);
      rejectErr.code = 'EREJECTED';
      rejectErr.statusCode = 422;
      rejectErr.responseCode = 550;
      logSafeMailError(operation, rejectErr, toEmail);
      throw rejectErr;
    }
    if (overrideResult && Array.isArray(overrideResult.accepted) && overrideResult.accepted.length === 0) {
      const emptyErr = new Error('Email provider did not accept delivery for recipient.');
      emptyErr.code = 'EUNACCEPTED';
      logSafeMailError(operation, emptyErr, toEmail);
      throw emptyErr;
    }
    const result = overrideResult || { messageId: 'override-msg-id', accepted: [toEmail] };
    logSafeMailSuccess(operation, result, toEmail);
    return result;
  }

  if (!isEmailConfigured()) {
    const configErr = new Error('Email service is not configured. Please set RESEND_API_KEY in server/.env.');
    configErr.code = 'ECONFIG_MISSING';
    logSafeMailError(operation, configErr, toEmail);
    throw configErr;
  }

  const sanitizedName = escapeHtml(name);
  const html = getHtmlTemplate({
    title: 'Verify Your Campus Book Exchange Account',
    preheader: `Your verification code is ${otp}. It expires in 5 minutes.`,
    bodyContent: `
      <h2 style="margin-top:0; color:#0f172a; font-size:20px;">Welcome to Campus Book Exchange, ${sanitizedName}!</h2>
      <p style="font-size:15px; color:#475569; line-height:1.5;">
        Thank you for joining our student community. To finish setting up your account and verify ownership of your Gmail address, please enter this verification code:
      </p>
      <div class="otp-box">
        <div style="font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#64748b; margin-bottom:6px;">Your 6-Digit Code</div>
        <div class="otp-code">${otp}</div>
      </div>
      <div class="warning">
        <strong>Important:</strong> This verification code is valid for <strong>5 minutes</strong>. If you did not initiate this registration, please disregard this email.
      </div>
    `,
  });

  const resend = new Resend(config.email.resendApiKey);
  let resendResponse;
  try {
    resendResponse = await resend.emails.send({
      from: config.email.from,
      to: [toEmail],
      subject: `${otp} is your verification code — Campus Book Exchange`,
      html,
    });
  } catch (sendErr) {
    logSafeMailError(operation, sendErr, toEmail);
    throw sendErr;
  }

  const { data, error } = resendResponse || {};
  if (error) {
    const providerErr = new Error(error.message || 'Resend failed to deliver email');
    providerErr.statusCode = error.statusCode;
    providerErr.name = error.name;
    logSafeMailError(operation, providerErr, toEmail);
    throw providerErr;
  }

  const result = { messageId: data?.id || 'resend-msg-id', accepted: [toEmail] };
  logSafeMailSuccess(operation, result, toEmail);
  return result;
};

/**
 * Send 6-digit OTP for Password Reset via Resend HTTPS API
 * @param {string} toEmail 
 * @param {string} otp 
 */
export const sendPasswordResetOtpEmail = async (toEmail, otp) => {
  const operation = 'sendPasswordResetOtpEmail';

  if (mailSenderOverride) {
    let overrideResult;
    try {
      overrideResult = await mailSenderOverride({ type: 'reset', to: toEmail, otp });
    } catch (overrideErr) {
      logSafeMailError(operation, overrideErr, toEmail);
      throw overrideErr;
    }
    if (overrideResult && Array.isArray(overrideResult.rejected) && overrideResult.rejected.length > 0) {
      const rejectErr = new Error(`Email provider rejected recipient: ${overrideResult.rejected.join(', ')}`);
      rejectErr.code = 'EREJECTED';
      rejectErr.statusCode = 422;
      rejectErr.responseCode = 550;
      logSafeMailError(operation, rejectErr, toEmail);
      throw rejectErr;
    }
    if (overrideResult && Array.isArray(overrideResult.accepted) && overrideResult.accepted.length === 0) {
      const emptyErr = new Error('Email provider did not accept delivery for recipient.');
      emptyErr.code = 'EUNACCEPTED';
      logSafeMailError(operation, emptyErr, toEmail);
      throw emptyErr;
    }
    const result = overrideResult || { messageId: 'override-msg-id', accepted: [toEmail] };
    logSafeMailSuccess(operation, result, toEmail);
    return result;
  }

  if (!isEmailConfigured()) {
    const configErr = new Error('Email service is not configured. Please set RESEND_API_KEY in server/.env.');
    configErr.code = 'ECONFIG_MISSING';
    logSafeMailError(operation, configErr, toEmail);
    throw configErr;
  }

  const html = getHtmlTemplate({
    title: 'Password Reset Request',
    preheader: `Your password reset code is ${otp}. It expires in 5 minutes.`,
    bodyContent: `
      <h2 style="margin-top:0; color:#0f172a; font-size:20px;">Password Reset Request</h2>
      <p style="font-size:15px; color:#475569; line-height:1.5;">
        We received a request to reset your password for your Campus Book Exchange account. Use the code below to verify your identity:
      </p>
      <div class="otp-box">
        <div style="font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#64748b; margin-bottom:6px;">Password Reset Code</div>
        <div class="otp-code">${otp}</div>
      </div>
      <div class="warning">
        <strong>Security Notice:</strong> This code is valid for <strong>5 minutes</strong>. If you did not request a password reset, someone may be trying to access your account. You can safely ignore this email; your password will not change without this code.
      </div>
    `,
  });

  const resend = new Resend(config.email.resendApiKey);
  let resendResponse;
  try {
    resendResponse = await resend.emails.send({
      from: config.email.from,
      to: [toEmail],
      subject: `${otp} is your password reset code — Campus Book Exchange`,
      html,
    });
  } catch (sendErr) {
    logSafeMailError(operation, sendErr, toEmail);
    throw sendErr;
  }

  const { data, error } = resendResponse || {};
  if (error) {
    const providerErr = new Error(error.message || 'Resend failed to deliver email');
    providerErr.statusCode = error.statusCode;
    providerErr.name = error.name;
    logSafeMailError(operation, providerErr, toEmail);
    throw providerErr;
  }

  const result = { messageId: data?.id || 'resend-msg-id', accepted: [toEmail] };
  logSafeMailSuccess(operation, result, toEmail);
  return result;
};
