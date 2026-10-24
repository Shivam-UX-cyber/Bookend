import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  User,
  Shield,
  Eye,
  EyeOff,
  Save,
  ExternalLink,
  GraduationCap,
  Building,
  BookOpen,
  MapPin,
  Calendar,
  Image as ImageIcon,
  Sparkles,
  AlertCircle,
  RefreshCw,
  X,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { userService } from '../services/userService';
import { Alert } from '../components/Alert';

const STUDY_YEARS = [
  '',
  '1st Year',
  '2nd Year',
  '3rd Year',
  '4th Year',
  '5th Year',
  'Graduate / PhD',
];

export const ProfileEditPage = () => {
  const { user, checkAuthStatus } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saveFeedback, setSaveFeedback] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);

  const [formData, setFormData] = useState({
    displayName: '',
    bio: '',
    department: '',
    course: '',
    studyYear: '',
    campus: '',
    avatarUrl: '',
    privacy: {
      showBio: true,
      showDepartment: false,
      showCourse: false,
      showStudyYear: false,
      showCampus: false,
    },
  });

  const [originalEmail, setOriginalEmail] = useState('');
  const [accountCreatedAt, setAccountCreatedAt] = useState(null);

  // Field validation rules
  const validateField = useCallback((name, value) => {
    switch (name) {
      case 'displayName': {
        const trimmed = (value || '').trim();
        if (trimmed.length > 70) {
          return 'Display name cannot exceed 70 characters.';
        }
        if (/[<>{}]/.test(trimmed)) {
          return 'Display name cannot contain special characters (<, >, {, }).';
        }
        return null;
      }
      case 'avatarUrl': {
        const trimmed = (value || '').trim();
        if (trimmed.length > 0) {
          try {
            const parsed = new URL(trimmed);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              return 'Avatar URL must start with http:// or https://';
            }
          } catch {
            return 'Please enter a valid web URL (e.g. https://example.com/photo.jpg)';
          }
        }
        return null;
      }
      case 'bio': {
        const trimmed = (value || '').trim();
        if (trimmed.length > 500) {
          return 'Bio cannot exceed 500 characters.';
        }
        return null;
      }
      case 'department': {
        const trimmed = (value || '').trim();
        if (trimmed.length > 100) {
          return 'Department cannot exceed 100 characters.';
        }
        return null;
      }
      case 'course': {
        const trimmed = (value || '').trim();
        if (trimmed.length > 100) {
          return 'Course cannot exceed 100 characters.';
        }
        return null;
      }
      case 'campus': {
        const trimmed = (value || '').trim();
        if (trimmed.length > 100) {
          return 'Campus location cannot exceed 100 characters.';
        }
        return null;
      }
      default:
        return null;
    }
  }, []);

  // Fetch current user profile
  const fetchProfile = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await userService.getMyProfile();
      if (res?.success && res.data?.profile) {
        const p = res.data.profile;
        setFormData({
          displayName: p.displayName || '',
          bio: p.bio || '',
          department: p.department || '',
          course: p.course || '',
          studyYear: p.studyYear || '',
          campus: p.campus || '',
          avatarUrl: p.avatarUrl || '',
          privacy: {
            showBio: p.privacy?.showBio !== false,
            showDepartment: Boolean(p.privacy?.showDepartment),
            showCourse: Boolean(p.privacy?.showCourse),
            showStudyYear: Boolean(p.privacy?.showStudyYear),
            showCampus: Boolean(p.privacy?.showCampus),
          },
        });
        setOriginalEmail(p.email || '');
        setAccountCreatedAt(p.createdAt || null);
        setFieldErrors({});
      }
    } catch (err) {
      setLoadError(err.message || 'Unable to load profile settings from server.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [formData.avatarUrl]);

  // Real-time field change handler
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    const err = validateField(name, value);
    setFieldErrors((prev) => ({ ...prev, [name]: err }));
    setSaveFeedback(null);
  };

  // Privacy toggles
  const handlePrivacyToggle = (key) => {
    setFormData((prev) => ({
      ...prev,
      privacy: {
        ...prev.privacy,
        [key]: !prev.privacy[key],
      },
    }));
    setSaveFeedback(null);
  };

  // Clear avatar photo
  const handleClearAvatar = () => {
    setFormData((prev) => ({ ...prev, avatarUrl: '' }));
    setFieldErrors((prev) => ({ ...prev, avatarUrl: null }));
    setAvatarLoadFailed(false);
  };

  // Validate entire form
  const validateAll = () => {
    const errors = {};
    const fieldsToValidate = ['displayName', 'avatarUrl', 'bio', 'department', 'course', 'campus'];

    fieldsToValidate.forEach((key) => {
      const err = validateField(key, formData[key]);
      if (err) {
        errors[key] = err;
      }
    });

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Save changes
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateAll()) {
      setSaveFeedback({
        type: 'error',
        message: 'Please resolve the highlighted field errors before saving.',
      });
      return;
    }

    setIsSaving(true);
    setSaveFeedback(null);

    try {
      const payload = {
        displayName: formData.displayName.trim(),
        bio: formData.bio.trim(),
        department: formData.department.trim(),
        course: formData.course.trim(),
        studyYear: formData.studyYear.trim(),
        campus: formData.campus.trim(),
        avatarUrl: formData.avatarUrl.trim(),
        privacy: {
          showBio: formData.privacy.showBio,
          showDepartment: formData.privacy.showDepartment,
          showCourse: formData.privacy.showCourse,
          showStudyYear: formData.privacy.showStudyYear,
          showCampus: formData.privacy.showCampus,
        },
      };

      const res = await userService.updateMyProfile(payload);
      if (res?.success) {
        setSaveFeedback({
          type: 'success',
          message: 'Profile and privacy settings saved successfully.',
        });
        if (checkAuthStatus) {
          checkAuthStatus();
        }
      }
    } catch (err) {
      setSaveFeedback({
        type: 'error',
        message: err.message || 'Failed to update profile. Please try again.',
      });
      if (err.data?.errors) {
        const serverFieldErrors = {};
        err.data.errors.forEach((eItem) => {
          serverFieldErrors[eItem.field] = eItem.message;
        });
        setFieldErrors(serverFieldErrors);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const effectiveDisplayName = formData.displayName.trim() || user?.name || 'Student';
  const myUserId = user?.id || user?._id;

  if (isLoading) {
    return (
      <div className="profile-container-simple" role="status" aria-live="polite">
        <div className="profile-simple-skeleton">
          <div className="skeleton-avatar-box" />
          <div className="skeleton-bar title" />
          <div className="skeleton-bar input" />
          <div className="skeleton-bar input" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="profile-container-simple">
        <Alert
          type="error"
          title="Could Not Load Profile"
          message={loadError}
          className="mb-4"
        />
        <button type="button" onClick={fetchProfile} className="btn-primary">
          <RefreshCw size={16} aria-hidden="true" />
          <span>Retry Loading Profile</span>
        </button>
      </div>
    );
  }

  return (
    <div className="page-shell-unified">
      {/* Unified Header */}
      <header className="page-header-unified">
        <div>
          <h1 className="page-title-unified">Edit Profile</h1>
          <p className="page-subtitle-unified">
            Update your student identity, avatar photo, and public privacy preferences.
          </p>
        </div>

        {myUserId && (
          <Link
            to={`/students/${myUserId}`}
            className="btn-secondary"
            id="view-public-profile-btn"
            target="_blank"
            rel="noopener noreferrer"
            title="Preview how other students see your profile"
          >
            <span>View Public Profile</span>
            <ExternalLink size={14} aria-hidden="true" />
          </Link>
        )}
      </header>

      {/* Save Feedback Alert */}
      {saveFeedback && (
        <Alert
          type={saveFeedback.type}
          message={saveFeedback.message}
          onDismiss={() => setSaveFeedback(null)}
          className="mb-6"
        />
      )}

      {/* Unified Settings Card */}
      <form onSubmit={handleSubmit} noValidate className="profile-card-unified">
        {/* SECTION 1: Identity & Avatar Banner */}
        <div className="profile-section-block">
          <div className="avatar-identity-row">
            {/* Avatar Preview */}
            <div className="avatar-simple-box">
              {formData.avatarUrl && !avatarLoadFailed ? (
                <img
                  src={formData.avatarUrl}
                  alt={effectiveDisplayName}
                  className="avatar-simple-img"
                  onError={() => setAvatarLoadFailed(true)}
                />
              ) : (
                <div className="avatar-simple-fallback" aria-hidden="true">
                  {effectiveDisplayName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            {/* Avatar Photo Input & Info */}
            <div className="avatar-input-col">
              <div className="avatar-user-badge">
                <div className="avatar-badge-header">
                  <strong>{effectiveDisplayName}</strong>
                  <span className="campus-verified-tag">
                    <ShieldCheck size={12} aria-hidden="true" />
                    <span>Email-Verified Peer</span>
                  </span>
                </div>
                <span className="user-email-text">{originalEmail}</span>
                {accountCreatedAt && (
                  <span className="user-member-since">
                    <Calendar size={12} aria-hidden="true" />
                    <span>Member since {new Date(accountCreatedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
                  </span>
                )}
              </div>

              <div className="form-group mb-0">
                <label htmlFor="avatarUrl" className="field-label-simple">
                  Profile Photo URL
                </label>
                <div className="url-input-wrapper">
                  <input
                    type="url"
                    id="avatarUrl"
                    name="avatarUrl"
                    value={formData.avatarUrl}
                    onChange={handleChange}
                    placeholder="https://example.com/your-photo.jpg"
                    className={`simple-text-input ${fieldErrors.avatarUrl ? 'input-invalid' : ''}`}
                    disabled={isSaving}
                    aria-invalid={Boolean(fieldErrors.avatarUrl)}
                  />
                  {formData.avatarUrl && (
                    <button
                      type="button"
                      onClick={handleClearAvatar}
                      className="url-clear-btn"
                      title="Clear photo URL"
                      aria-label="Clear photo URL"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {fieldErrors.avatarUrl && (
                  <div className="field-error-message" role="alert">
                    <AlertCircle size={13} aria-hidden="true" />
                    <span>{fieldErrors.avatarUrl}</span>
                  </div>
                )}

                {formData.avatarUrl && avatarLoadFailed && !fieldErrors.avatarUrl && (
                  <div className="field-error-message" role="alert">
                    <AlertCircle size={13} aria-hidden="true" />
                    <span>Image could not be loaded. Displaying initials fallback.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="profile-divider" />

        {/* SECTION 2: Personal Information */}
        <div className="profile-section-block">
          <h2 className="section-title-simple">
            <User size={16} aria-hidden="true" />
            <span>Personal Information</span>
          </h2>

          <div className="form-group">
            <div className="field-label-row">
              <label htmlFor="displayName" className="field-label-simple">
                Display Name <span className="optional-tag">(Optional)</span>
              </label>
              <span
                className={`char-counter-simple ${
                  formData.displayName.length > 70
                    ? 'danger'
                    : formData.displayName.length > 60
                    ? 'warning'
                    : ''
                }`}
              >
                {formData.displayName.length}/70
              </span>
            </div>
            <input
              type="text"
              id="displayName"
              name="displayName"
              value={formData.displayName}
              onChange={handleChange}
              maxLength={80}
              placeholder={`Leave blank to use "${user?.name || 'Student'}"`}
              className={`simple-text-input ${fieldErrors.displayName ? 'input-invalid' : ''}`}
              disabled={isSaving}
              aria-invalid={Boolean(fieldErrors.displayName)}
            />
            {fieldErrors.displayName && (
              <div className="field-error-message" role="alert">
                <AlertCircle size={13} aria-hidden="true" />
                <span>{fieldErrors.displayName}</span>
              </div>
            )}
            <span className="field-hint-simple">
              Displayed to fellow students on your listings and public seller profile.
            </span>
          </div>

          <div className="form-group mt-4">
            <div className="field-label-row">
              <label htmlFor="bio" className="field-label-simple">
                Bio / About You <span className="optional-tag">(Optional)</span>
              </label>
              <span
                className={`char-counter-simple ${
                  formData.bio.length > 500
                    ? 'danger'
                    : formData.bio.length > 450
                    ? 'warning'
                    : ''
                }`}
              >
                {formData.bio.length}/500
              </span>
            </div>
            <textarea
              id="bio"
              name="bio"
              value={formData.bio}
              onChange={handleChange}
              maxLength={520}
              rows={3}
              placeholder="Tell campus buyers about your major, campus meet preferences, or subjects..."
              className={`simple-textarea ${fieldErrors.bio ? 'input-invalid' : ''}`}
              disabled={isSaving}
              aria-invalid={Boolean(fieldErrors.bio)}
            />
            {fieldErrors.bio && (
              <div className="field-error-message" role="alert">
                <AlertCircle size={13} aria-hidden="true" />
                <span>{fieldErrors.bio}</span>
              </div>
            )}
            <span className="field-hint-simple">
              Visible on your public profile if "Show Bio" is enabled below.
            </span>
          </div>
        </div>

        <div className="profile-divider" />

        {/* SECTION 3: Academic Details */}
        <div className="profile-section-block">
          <h2 className="section-title-simple">
            <GraduationCap size={16} aria-hidden="true" />
            <span>Academic Details</span>
          </h2>

          <div className="simple-grid-2col">
            <div className="form-group">
              <label htmlFor="department" className="field-label-simple">
                Department
              </label>
              <input
                type="text"
                id="department"
                name="department"
                value={formData.department}
                onChange={handleChange}
                maxLength={110}
                placeholder="e.g. Computer Science"
                className={`simple-text-input ${fieldErrors.department ? 'input-invalid' : ''}`}
                disabled={isSaving}
                aria-invalid={Boolean(fieldErrors.department)}
              />
              {fieldErrors.department && (
                <div className="field-error-message" role="alert">
                  <AlertCircle size={13} aria-hidden="true" />
                  <span>{fieldErrors.department}</span>
                </div>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="course" className="field-label-simple">
                Course / Degree
              </label>
              <input
                type="text"
                id="course"
                name="course"
                value={formData.course}
                onChange={handleChange}
                maxLength={110}
                placeholder="e.g. B.Tech, MBA, M.Sc"
                className={`simple-text-input ${fieldErrors.course ? 'input-invalid' : ''}`}
                disabled={isSaving}
                aria-invalid={Boolean(fieldErrors.course)}
              />
              {fieldErrors.course && (
                <div className="field-error-message" role="alert">
                  <AlertCircle size={13} aria-hidden="true" />
                  <span>{fieldErrors.course}</span>
                </div>
              )}
            </div>
          </div>

          <div className="simple-grid-2col mt-4">
            <div className="form-group">
              <label htmlFor="studyYear" className="field-label-simple">
                Year of Study
              </label>
              <select
                id="studyYear"
                name="studyYear"
                value={formData.studyYear}
                onChange={handleChange}
                className="simple-select-input"
                disabled={isSaving}
              >
                <option value="">-- Select Year of Study --</option>
                {STUDY_YEARS.filter(Boolean).map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="campus" className="field-label-simple">
                Campus Location
              </label>
              <input
                type="text"
                id="campus"
                name="campus"
                value={formData.campus}
                onChange={handleChange}
                maxLength={110}
                placeholder="e.g. North Campus, Main Library"
                className={`simple-text-input ${fieldErrors.campus ? 'input-invalid' : ''}`}
                disabled={isSaving}
                aria-invalid={Boolean(fieldErrors.campus)}
              />
              {fieldErrors.campus && (
                <div className="field-error-message" role="alert">
                  <AlertCircle size={13} aria-hidden="true" />
                  <span>{fieldErrors.campus}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="profile-divider" />

        {/* SECTION 4: Profile Visibility & Privacy */}
        <div className="profile-section-block">
          <h2 className="section-title-simple">
            <Shield size={16} aria-hidden="true" />
            <span>Profile Visibility & Privacy</span>
          </h2>
          <p className="section-sub-simple">
            Choose which information fellow students can see on your public profile.
          </p>

          <div className="simple-privacy-list">
            {/* Bio Toggle */}
            <div className="simple-privacy-row">
              <div className="privacy-label-box">
                <span className="privacy-item-title">Show Bio publicly</span>
                <span className="privacy-item-desc">Allows prospective buyers to read your bio</span>
              </div>
              <div className="privacy-toggle-control">
                {formData.privacy.showBio ? (
                  <span className="visibility-badge visible">
                    <Eye size={12} aria-hidden="true" /> Visible
                  </span>
                ) : (
                  <span className="visibility-badge hidden">
                    <EyeOff size={12} aria-hidden="true" /> Hidden
                  </span>
                )}
                <label className="switch" htmlFor="privacy-toggle-bio">
                  <input
                    type="checkbox"
                    id="privacy-toggle-bio"
                    checked={formData.privacy.showBio}
                    onChange={() => handlePrivacyToggle('showBio')}
                    disabled={isSaving}
                  />
                  <span className="slider round" />
                </label>
              </div>
            </div>

            {/* Department Toggle */}
            <div className="simple-privacy-row">
              <div className="privacy-label-box">
                <span className="privacy-item-title">Show Academic Department</span>
                <span className="privacy-item-desc">Displays your department on your profile</span>
              </div>
              <div className="privacy-toggle-control">
                {formData.privacy.showDepartment ? (
                  <span className="visibility-badge visible">
                    <Eye size={12} aria-hidden="true" /> Visible
                  </span>
                ) : (
                  <span className="visibility-badge hidden">
                    <EyeOff size={12} aria-hidden="true" /> Hidden
                  </span>
                )}
                <label className="switch" htmlFor="privacy-toggle-dept">
                  <input
                    type="checkbox"
                    id="privacy-toggle-dept"
                    checked={formData.privacy.showDepartment}
                    onChange={() => handlePrivacyToggle('showDepartment')}
                    disabled={isSaving}
                  />
                  <span className="slider round" />
                </label>
              </div>
            </div>

            {/* Course Toggle */}
            <div className="simple-privacy-row">
              <div className="privacy-label-box">
                <span className="privacy-item-title">Show Course / Degree</span>
                <span className="privacy-item-desc">Displays your degree or program of study</span>
              </div>
              <div className="privacy-toggle-control">
                {formData.privacy.showCourse ? (
                  <span className="visibility-badge visible">
                    <Eye size={12} aria-hidden="true" /> Visible
                  </span>
                ) : (
                  <span className="visibility-badge hidden">
                    <EyeOff size={12} aria-hidden="true" /> Hidden
                  </span>
                )}
                <label className="switch" htmlFor="privacy-toggle-course">
                  <input
                    type="checkbox"
                    id="privacy-toggle-course"
                    checked={formData.privacy.showCourse}
                    onChange={() => handlePrivacyToggle('showCourse')}
                    disabled={isSaving}
                  />
                  <span className="slider round" />
                </label>
              </div>
            </div>

            {/* Year of Study Toggle */}
            <div className="simple-privacy-row">
              <div className="privacy-label-box">
                <span className="privacy-item-title">Show Year of Study</span>
                <span className="privacy-item-desc">Displays your current university year</span>
              </div>
              <div className="privacy-toggle-control">
                {formData.privacy.showStudyYear ? (
                  <span className="visibility-badge visible">
                    <Eye size={12} aria-hidden="true" /> Visible
                  </span>
                ) : (
                  <span className="visibility-badge hidden">
                    <EyeOff size={12} aria-hidden="true" /> Hidden
                  </span>
                )}
                <label className="switch" htmlFor="privacy-toggle-year">
                  <input
                    type="checkbox"
                    id="privacy-toggle-year"
                    checked={formData.privacy.showStudyYear}
                    onChange={() => handlePrivacyToggle('showStudyYear')}
                    disabled={isSaving}
                  />
                  <span className="slider round" />
                </label>
              </div>
            </div>

            {/* Campus Toggle */}
            <div className="simple-privacy-row">
              <div className="privacy-label-box">
                <span className="privacy-item-title">Show Campus Location</span>
                <span className="privacy-item-desc">Helps peers coordinate in-person textbook exchanges</span>
              </div>
              <div className="privacy-toggle-control">
                {formData.privacy.showCampus ? (
                  <span className="visibility-badge visible">
                    <Eye size={12} aria-hidden="true" /> Visible
                  </span>
                ) : (
                  <span className="visibility-badge hidden">
                    <EyeOff size={12} aria-hidden="true" /> Hidden
                  </span>
                )}
                <label className="switch" htmlFor="privacy-toggle-campus">
                  <input
                    type="checkbox"
                    id="privacy-toggle-campus"
                    checked={formData.privacy.showCampus}
                    onChange={() => handlePrivacyToggle('showCampus')}
                    disabled={isSaving}
                  />
                  <span className="slider round" />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="profile-actions-simple">
          <button
            type="submit"
            disabled={isSaving}
            className="btn-primary"
            id="save-profile-btn"
          >
            <Save size={16} aria-hidden="true" />
            <span>{isSaving ? 'Saving Changes...' : 'Save Profile Changes'}</span>
          </button>

          <button
            type="button"
            onClick={fetchProfile}
            disabled={isSaving}
            className="btn-secondary"
          >
            Reset Unsaved Changes
          </button>
        </div>
      </form>
    </div>
  );
};

export default ProfileEditPage;
