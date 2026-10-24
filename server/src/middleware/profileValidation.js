import mongoose from 'mongoose';

export const ALLOWED_PROFILE_FIELDS = [
  'displayName',
  'bio',
  'department',
  'course',
  'studyYear',
  'campus',
  'avatarUrl',
  'privacy',
];

export const ALLOWED_PRIVACY_KEYS = [
  'showBio',
  'showDepartment',
  'showCourse',
  'showStudyYear',
  'showCampus',
];

export const ALLOWED_STUDY_YEARS = [
  '',
  '1st Year',
  '2nd Year',
  '3rd Year',
  '4th Year',
  '5th Year',
  'Graduate / PhD',
];

/**
 * Validates MongoDB ObjectId param for public student profile.
 * Returns 404 on malformed ID to avoid leaking record absence vs malformed syntax.
 */
export const validateUserId = (req, res, next) => {
  const { userId } = req.params;
  if (!userId || !mongoose.isValidObjectId(userId)) {
    return res.status(404).json({
      success: false,
      message: 'Student profile not found.',
    });
  }
  next();
};

/**
 * Validates avatar URL scheme and structure safely without performing SSRF requests.
 */
export const isValidAvatarUrl = (url) => {
  if (!url || typeof url !== 'string') return true;
  const trimmed = url.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length > 2000) return false;

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (err) {
    return false;
  }
};

/**
 * Comprehensive validation middleware for profile updates:
 * - Rejects mass-assignment attempts and unknown root fields
 * - Validates length boundaries and data types
 * - Validates study year enum
 * - Enforces safe http/https avatar URLs
 * - Enforces strictly allowlisted privacy keys and boolean types
 */
export const validateProfileUpdate = (req, res, next) => {
  const errors = [];
  const bodyKeys = Object.keys(req.body || {});

  // 1. Root field allowlist check (prevents mass-assignment)
  for (const key of bodyKeys) {
    if (!ALLOWED_PROFILE_FIELDS.includes(key)) {
      errors.push({
        field: key,
        message: `Field "${key}" cannot be updated via profile settings.`,
      });
    }
  }

  // 2. Validate string fields if present
  const stringFields = [
    { name: 'displayName', max: 70, label: 'Display name' },
    { name: 'bio', max: 500, label: 'Bio' },
    { name: 'department', max: 100, label: 'Department' },
    { name: 'course', max: 100, label: 'Course' },
    { name: 'campus', max: 100, label: 'Campus' },
  ];

  for (const { name, max, label } of stringFields) {
    if (name in req.body) {
      const val = req.body[name];
      if (typeof val !== 'string') {
        errors.push({ field: name, message: `${label} must be a text string.` });
      } else if (val.trim().length > max) {
        errors.push({ field: name, message: `${label} cannot exceed ${max} characters.` });
      }
    }
  }

  // 3. Study Year enum check
  if ('studyYear' in req.body) {
    const val = req.body.studyYear;
    if (typeof val !== 'string') {
      errors.push({ field: 'studyYear', message: 'Year of study must be a string.' });
    } else if (!ALLOWED_STUDY_YEARS.includes(val.trim())) {
      errors.push({
        field: 'studyYear',
        message: 'Invalid year of study. Must be one of: 1st Year, 2nd Year, 3rd Year, 4th Year, 5th Year, Graduate / PhD.',
      });
    }
  }

  // 4. Avatar URL validation
  if ('avatarUrl' in req.body) {
    const val = req.body.avatarUrl;
    if (typeof val !== 'string') {
      errors.push({ field: 'avatarUrl', message: 'Avatar URL must be a string.' });
    } else if (val.trim().length > 0 && !isValidAvatarUrl(val)) {
      errors.push({
        field: 'avatarUrl',
        message: 'Avatar URL must be a valid web address starting with http:// or https://.',
      });
    }
  }

  // 5. Nested privacy settings validation
  if ('privacy' in req.body) {
    const privacy = req.body.privacy;
    if (typeof privacy !== 'object' || privacy === null || Array.isArray(privacy)) {
      errors.push({ field: 'privacy', message: 'Privacy settings must be a configuration object.' });
    } else {
      const privacyKeys = Object.keys(privacy);
      for (const pKey of privacyKeys) {
        if (!ALLOWED_PRIVACY_KEYS.includes(pKey)) {
          errors.push({
            field: `privacy.${pKey}`,
            message: `Unsupported privacy option "${pKey}".`,
          });
        } else if (typeof privacy[pKey] !== 'boolean') {
          errors.push({
            field: `privacy.${pKey}`,
            message: `Privacy setting "${pKey}" must be true or false.`,
          });
        }
      }
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: errors[0].message,
      errors,
    });
  }

  next();
};
