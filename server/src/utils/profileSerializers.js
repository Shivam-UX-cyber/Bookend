/**
 * Profile serialization utilities for Bookend.
 * Strictly separates private profile DTO from public profile DTO
 * to enforce server-side privacy boundaries.
 */

/**
 * Serializes private profile data for the authenticated account owner.
 * Contains editable profile fields and the owner's privacy settings.
 * NEVER exposes passwords, tokens, or security credentials.
 *
 * @param {Object} user Mongoose user document or plain object
 * @returns {Object} Safe private profile DTO
 */
export const serializePrivateProfile = (user) => {
  if (!user) return null;

  const rawPrivacy = user.privacy || {};

  return {
    id: user._id || user.id,
    name: user.name || '',
    displayName: user.displayName || '',
    email: user.email || '',
    avatarUrl: user.avatarUrl || '',
    bio: user.bio || '',
    department: user.department || '',
    course: user.course || '',
    studyYear: user.studyYear || '',
    campus: user.campus || '',
    privacy: {
      showBio: rawPrivacy.showBio !== false, // default true
      showDepartment: Boolean(rawPrivacy.showDepartment), // default false
      showCourse: Boolean(rawPrivacy.showCourse), // default false
      showStudyYear: Boolean(rawPrivacy.showStudyYear), // default false
      showCampus: Boolean(rawPrivacy.showCampus), // default false
    },
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

/**
 * Serializes public student profile data for public consumption.
 * Strictly enforces server-side privacy rules:
 * - Email, password, tokens, internal flags, and private purchase activity are NEVER returned.
 * - Bio and academic attributes are returned ONLY if permitted by privacy settings AND non-empty.
 * - Private fields are completely omitted from the payload rather than sent as empty/hidden.
 *
 * @param {Object} user Mongoose user document or plain object
 * @param {Array} books Sanitized array of seller listings
 * @param {Object} pagination Pagination metadata
 * @returns {Object} Safe public student profile DTO
 */
export const serializePublicProfile = (user, books = [], pagination = null) => {
  if (!user) return null;

  const rawPrivacy = user.privacy || {};
  const showBio = rawPrivacy.showBio !== false;
  const showDepartment = Boolean(rawPrivacy.showDepartment);
  const showCourse = Boolean(rawPrivacy.showCourse);
  const showStudyYear = Boolean(rawPrivacy.showStudyYear);
  const showCampus = Boolean(rawPrivacy.showCampus);

  const displayName = (user.displayName && typeof user.displayName === 'string' && user.displayName.trim())
    ? user.displayName.trim()
    : user.name;

  const publicProfile = {
    id: user._id || user.id,
    displayName,
    avatarUrl: user.avatarUrl || '',
    createdAt: user.createdAt,
  };

  // Only include optional fields if allowed by privacy settings and non-empty
  if (showBio && user.bio && typeof user.bio === 'string' && user.bio.trim()) {
    publicProfile.bio = user.bio.trim();
  }

  if (showDepartment && user.department && typeof user.department === 'string' && user.department.trim()) {
    publicProfile.department = user.department.trim();
  }

  if (showCourse && user.course && typeof user.course === 'string' && user.course.trim()) {
    publicProfile.course = user.course.trim();
  }

  if (showStudyYear && user.studyYear && typeof user.studyYear === 'string' && user.studyYear.trim()) {
    publicProfile.studyYear = user.studyYear.trim();
  }

  if (showCampus && user.campus && typeof user.campus === 'string' && user.campus.trim()) {
    publicProfile.campus = user.campus.trim();
  }

  // Public listings by this seller
  publicProfile.books = Array.isArray(books) ? books : [];

  if (pagination) {
    publicProfile.pagination = pagination;
  }

  return publicProfile;
};
