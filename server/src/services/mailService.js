import nodemailer from 'nodemailer';
import { config } from '../config/env.js';

let mailSenderOverride = null;

/**
 * Allows integration tests to intercept or simulate mail delivery
 * @param {Function|null} fn 
 */
export const setMailSenderOverride = (fn) => {
  mailSenderOverride = fn;
};

/**
 * Check if real SMTP credentials are provided
 */
export const isSmtpConfigured = () => {
  return (
    Boolean(config.smtp.user) &&
    Boolean(config.smtp.appPassword) &&
    !config.smtp.user.includes('your-verified-account') &&
    !config.smtp.appPassword.includes('your-16-char')
  );
};

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
 * Sanitizes an error message or SMTP provider string by removing any sensitive patterns:
 * - 6-digit numeric sequences (OTPs)
 * - 16-character continuous alphabetic sequences (Gmail App Passwords)
 * - Bearer tokens, passwords, secrets, or cookies
 * @param {string} text
 * @returns {string}
 */
export const sanitizeProviderErrorDetails = (text) => {
  if (!text || typeof text !== 'string') return '';
  return text
    // Redact 6-digit OTP codes (exact boundary)
    .replace(/\b\d{6}\b/g, '[REDACTED_OTP]')
    // Redact 16-character App Passwords
    .replace(/\b[a-zA-Z]{16}\b/g, '[REDACTED_APP_PASSWORD]')
    // Redact Bearer tokens
    .replace(/bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED_TOKEN]')
    // Redact password/token/key assignments (e.g. pass=xyz, password: xyz, secret=xyz)
    .replace(/(password|passwd|pass|secret|token|apiKey|api_key|auth)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]')
    // Redact basic auth header tokens in string
    .replace(/basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [REDACTED_AUTH]');
};

/**
 * Safely extracts non-sensitive SMTP diagnostics from an Error or Nodemailer response.
 * Strictly guarantees that passwords, tokens, cookies, and 6-digit OTP codes are NEVER logged.
 * @param {string} operation
 * @param {Error|object} err
 * @param {string} [recipientEmail]
 * @returns {object}
 */
export const extractMailDiagnostics = (operation, err, recipientEmail = null) => {
  const errorObj = err || {};
  const rawMessage = errorObj.message || String(errorObj);
  const rawResponse = errorObj.response || null;

  return {
    operation: operation || 'unknownMailOperation',
    errorName: errorObj.name || 'Error',
    errorCode: errorObj.code || null,
    responseCode: errorObj.responseCode || (typeof errorObj.response === 'string' && errorObj.response.match(/^\d{3}/) ? parseInt(errorObj.response.substring(0, 3), 10) : null),
    command: errorObj.command || null,
    syscall: errorObj.syscall || null,
    smtpHost: config.smtp?.host || 'smtp.gmail.com',
    smtpPort: config.smtp?.port || 465,
    smtpSecure: Boolean(config.smtp?.secure),
    isConfigured: isSmtpConfigured(),
    recipient: recipientEmail ? maskEmail(recipientEmail) : null,
    details: sanitizeProviderErrorDetails(rawResponse || rawMessage),
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
 * Logs a safe, structured diagnostic message to console.log on successful mail delivery
 * @param {string} operation
 * @param {object} info
 * @param {string} [recipientEmail]
 * @returns {object}
 */
export const logSafeMailSuccess = (operation, info, recipientEmail = null) => {
  const accepted = Array.isArray(info?.accepted) ? info.accepted.map(maskEmail) : [];
  const logData = {
    operation: operation || 'unknownMailOperation',
    status: 'accepted',
    messageId: info?.messageId || null,
    acceptedRecipients: accepted,
    smtpHost: config.smtp?.host || 'smtp.gmail.com',
    smtpPort: config.smtp?.port || 465,
    timestamp: new Date().toISOString(),
  };
  console.log('\x1b[32m%s\x1b[0m', `[MailService Success] ${JSON.stringify(logData)}`);
  return logData;
};

const createTransporter = () => {
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.appPassword,
    },
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000,   // 10 seconds
    socketTimeout: 15000,     // 15 seconds
  });
};

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
 * Send 6-digit OTP for Registration Verification
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

  if (!isSmtpConfigured()) {
    const configErr = new Error('SMTP email service is not configured. Please set EMAIL_USER and EMAIL_APP_PASSWORD in server/.env.');
    configErr.code = 'ECONFIG_MISSING';
    logSafeMailError(operation, configErr, toEmail);
    throw configErr;
  }

  const sanitizedName = escapeHtml(name);
  const transporter = createTransporter();
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

  let info;
  try {
    info = await transporter.sendMail({
      from: `"Campus Book Exchange" <${config.smtp.user}>`,
      to: toEmail,
      subject: `${otp} is your verification code — Campus Book Exchange`,
      html,
    });
  } catch (sendErr) {
    logSafeMailError(operation, sendErr, toEmail);
    throw sendErr;
  }

  // Verify that the email provider actually accepted the message for delivery
  if (info && Array.isArray(info.rejected) && info.rejected.length > 0) {
    const rejectErr = new Error(`Email provider rejected delivery to recipient: ${info.rejected.join(', ')}`);
    rejectErr.code = 'EREJECTED';
    rejectErr.responseCode = 550;
    logSafeMailError(operation, rejectErr, toEmail);
    throw rejectErr;
  }
  if (info && Array.isArray(info.accepted) && info.accepted.length === 0) {
    const emptyErr = new Error('Email provider did not accept delivery for recipient.');
    emptyErr.code = 'EUNACCEPTED';
    logSafeMailError(operation, emptyErr, toEmail);
    throw emptyErr;
  }

  logSafeMailSuccess(operation, info, toEmail);
  return { messageId: info.messageId, accepted: info.accepted };
};

/**
 * Send 6-digit OTP for Password Reset
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

  if (!isSmtpConfigured()) {
    const configErr = new Error('SMTP email service is not configured. Please set EMAIL_USER and EMAIL_APP_PASSWORD in server/.env.');
    configErr.code = 'ECONFIG_MISSING';
    logSafeMailError(operation, configErr, toEmail);
    throw configErr;
  }

  const transporter = createTransporter();
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

  let info;
  try {
    info = await transporter.sendMail({
      from: `"Campus Book Exchange Security" <${config.smtp.user}>`,
      to: toEmail,
      subject: `${otp} is your password reset code — Campus Book Exchange`,
      html,
    });
  } catch (sendErr) {
    logSafeMailError(operation, sendErr, toEmail);
    throw sendErr;
  }

  // Verify that the email provider actually accepted the message for delivery
  if (info && Array.isArray(info.rejected) && info.rejected.length > 0) {
    const rejectErr = new Error(`Email provider rejected delivery to recipient: ${info.rejected.join(', ')}`);
    rejectErr.code = 'EREJECTED';
    rejectErr.responseCode = 550;
    logSafeMailError(operation, rejectErr, toEmail);
    throw rejectErr;
  }
  if (info && Array.isArray(info.accepted) && info.accepted.length === 0) {
    const emptyErr = new Error('Email provider did not accept delivery for recipient.');
    emptyErr.code = 'EUNACCEPTED';
    logSafeMailError(operation, emptyErr, toEmail);
    throw emptyErr;
  }

  logSafeMailSuccess(operation, info, toEmail);
  return { messageId: info.messageId, accepted: info.accepted };
};
