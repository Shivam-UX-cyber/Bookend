import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Mail, ArrowRight, Loader2, BookOpen, ShieldCheck } from 'lucide-react';
import { useAuth, getSafeRedirectPath } from '../context/AuthContext';
import { PasswordInput } from '../components/PasswordInput';
import { Alert } from '../components/Alert';

import { validateGmail, getUtf8ByteLength } from '../utils/validation';

export const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const prefillEmail = location.state?.prefillEmail || '';
  const initialSuccess = location.state?.successMessage || '';

  const [formData, setFormData] = useState({
    email: prefillEmail,
    password: '',
  });

  const [fieldErrors, setFieldErrors] = useState({});
  const [generalError, setGeneralError] = useState('');
  const [successMessage, setSuccessMessage] = useState(initialSuccess);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: '' }));
    }
    if (generalError) {
      setGeneralError('');
    }
  };

  const validate = () => {
    const errors = {};

    const emailCheck = validateGmail(formData.email);
    if (!emailCheck.isValid) {
      errors.email = emailCheck.errorMessage;
    }

    if (!formData.password) {
      errors.password = 'Password is required.';
    } else if (getUtf8ByteLength(formData.password) > 72) {
      errors.password = 'Password cannot exceed 72 bytes due to password hashing standards.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGeneralError('');
    setSuccessMessage('');

    if (!validate()) return;

    setIsSubmitting(true);

    try {
      await login(formData.email.trim().toLowerCase(), formData.password);
      // Navigate to intended page or dashboard with open-redirect protection
      const rawFrom = typeof location.state?.from === 'string'
        ? location.state.from
        : location.state?.from?.pathname;
      const safeDestination = getSafeRedirectPath(rawFrom, '/dashboard');
      navigate(safeDestination, { replace: true });
    } catch (err) {
      setGeneralError(err.message || 'Login failed. Please verify your email and password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-page-container">
      <div className="auth-card-wrapper">
        <div className="auth-header">
          <div className="auth-icon-badge" aria-hidden="true">
            <BookOpen size={26} className="text-primary" />
          </div>
          <div className="auth-tag">Student Sign In</div>
          <h1 className="auth-title">Welcome Back</h1>
          <p className="auth-subtitle">
            Sign in to access your course book trades, textbook listings, and peer exchanges.
          </p>
        </div>

        {successMessage && <Alert type="success" message={successMessage} onDismiss={() => setSuccessMessage('')} />}
        {generalError && <Alert type="error" message={generalError} onDismiss={() => setGeneralError('')} />}

        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          {/* Email */}
          <div className={`form-group ${fieldErrors.email ? 'has-error' : ''}`}>
            <label htmlFor="email" className="form-label">
              Gmail <span className="required-indicator" aria-hidden="true">*</span>
            </label>
            <div className="input-wrapper">
              <Mail className="input-icon-left" size={18} aria-hidden="true" />
              <input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="student.name@gmail.com"
                required
                autoComplete="email"
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                className="form-input with-left-icon"
                disabled={isSubmitting}
              />
            </div>
            {fieldErrors.email && (
              <span id="email-error" className="field-error-text" role="alert">
                {fieldErrors.email}
              </span>
            )}
          </div>

          {/* Password */}
          <div>
            <PasswordInput
              id="password"
              name="password"
              label="Password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Enter your account password"
              error={fieldErrors.password}
              disabled={isSubmitting}
              autoComplete="current-password"
              required
            />
            <div className="form-extra-row">
              <Link to="/forgot-password" className="auth-link-subtle">
                Forgot password?
              </Link>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="btn-primary btn-block"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={18} className="spinner" aria-hidden="true" />
                <span>Signing in...</span>
              </>
            ) : (
              <>
                <span>Sign In to Dashboard</span>
                <ArrowRight size={18} aria-hidden="true" />
              </>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Don't have an account yet?{' '}
            <Link to="/register" className="auth-link">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};
