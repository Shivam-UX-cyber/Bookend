/**
 * Campus Book Exchange — Client Validation & Cryptographic Utility Module
 * Shared across Registration, Login, and Password Recovery pages.
 * Fully browser-compatible: does NOT use Node.js `Buffer`.
 */

/**
 * Calculates UTF-8 byte length safely in all browser environments.
 * Bcrypt has a hard limit of 72 bytes on input passwords.
 *
 * @param {string} str - Input string
 * @returns {number} Byte length in UTF-8
 */
export const getUtf8ByteLength = (str) => {
  if (typeof str !== 'string' || !str) return 0;
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length;
  }
  // Universal browser fallback using URI encoding
  try {
    return encodeURI(str).split(/%..|./).length - 1;
  } catch {
    return str.length;
  }
};

/**
 * Evaluates password security criteria.
 *
 * @param {string} password - Raw candidate password
 * @returns {{
 *   criteria: {
 *     length: boolean,
 *     upper: boolean,
 *     lower: boolean,
 *     number: boolean,
 *     special: boolean
 *   },
 *   byteLength: number,
 *   isValid: boolean,
 *   errorMessage: string
 * }}
 */
export const evaluatePassword = (password = '') => {
  const byteLength = getUtf8ByteLength(password);
  const criteria = {
    length: password.length >= 8 && byteLength <= 72,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*(),.?":{}|<>_\-+=~`]/.test(password),
  };

  const allMet = Object.values(criteria).every(Boolean);

  let errorMessage = '';
  if (!password) {
    errorMessage = 'Password is required.';
  } else if (byteLength > 72) {
    errorMessage = 'Password cannot exceed 72 bytes due to password hashing standards.';
  } else if (password.length < 8) {
    errorMessage = 'Password must be at least 8 characters long.';
  } else if (!allMet) {
    errorMessage = 'Password does not satisfy all required security criteria.';
  }

  return {
    criteria,
    byteLength,
    isValid: allMet && byteLength <= 72 && password.length >= 8,
    errorMessage,
  };
};

/**
 * Validates a personal Gmail address with strict username and dot placement rules.
 *
 * @param {string} rawEmail - Email address input
 * @returns {{ isValid: boolean, normalizedEmail: string, errorMessage: string }}
 */
export const validateGmail = (rawEmail = '') => {
  const normalizedEmail = (rawEmail || '').trim().toLowerCase();

  if (!normalizedEmail) {
    return {
      isValid: false,
      normalizedEmail: '',
      errorMessage: 'Gmail address is required.',
    };
  }

  const isDomainValid =
    normalizedEmail.endsWith('@gmail.com') || normalizedEmail.endsWith('@googlemail.com');

  if (!isDomainValid) {
    return {
      isValid: false,
      normalizedEmail,
      errorMessage: 'Only Gmail addresses (@gmail.com or @googlemail.com) are accepted.',
    };
  }

  const atIdx = normalizedEmail.indexOf('@');
  const username = atIdx !== -1 ? normalizedEmail.slice(0, atIdx) : '';
  const cleanUsername = username.replace(/\./g, '');

  if (
    !/^[a-z0-9.]+$/.test(username) ||
    username.startsWith('.') ||
    username.endsWith('.') ||
    username.includes('..') ||
    cleanUsername.length < 6 ||
    cleanUsername.length > 30
  ) {
    return {
      isValid: false,
      normalizedEmail,
      errorMessage:
        'Please enter a valid Gmail address (username must be 6-30 characters, no leading/trailing or consecutive dots).',
    };
  }

  return {
    isValid: true,
    normalizedEmail,
    errorMessage: '',
  };
};

/**
 * Validates student full name supporting international Unicode letters and combining marks.
 *
 * @param {string} rawName - Full name input
 * @returns {{ isValid: boolean, trimmedName: string, errorMessage: string }}
 */
export const validateInternationalName = (rawName = '') => {
  const trimmedName = (rawName || '').trim();

  if (!trimmedName) {
    return {
      isValid: false,
      trimmedName: '',
      errorMessage: 'Full name is required.',
    };
  }

  if (trimmedName.length < 2 || trimmedName.length > 70) {
    return {
      isValid: false,
      trimmedName,
      errorMessage: 'Name must be between 2 and 70 characters.',
    };
  }

  // Must contain at least one Unicode letter
  const hasLetter = /\p{L}/u.test(trimmedName);
  // Allowed characters: Unicode letters, marks, spaces, hyphens, apostrophes, and periods
  const validChars = /^[\p{L}\p{M}\s.'-]+$/u.test(trimmedName);

  if (!hasLetter || !validChars) {
    return {
      isValid: false,
      trimmedName,
      errorMessage:
        'Please enter a valid full name (letters, spaces, hyphens, and apostrophes allowed).',
    };
  }

  return {
    isValid: true,
    trimmedName,
    errorMessage: '',
  };
};

/**
 * Deadline-based countdown utility.
 * Handles background tab suspension and recalculates remaining seconds authoritatively.
 *
 * @param {number} deadlineMs - Epoch millisecond timestamp when cooldown expires
 * @returns {number} Remaining seconds (clamped to >= 0)
 */
export const calculateRemainingCooldown = (deadlineMs) => {
  if (!deadlineMs || typeof deadlineMs !== 'number') return 0;
  return Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
};
