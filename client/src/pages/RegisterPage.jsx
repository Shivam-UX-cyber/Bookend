import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, Mail, Check, ArrowRight, Loader2, BookOpen, ShieldCheck } from 'lucide-react';
import { authService } from '../services/authService';
import { PasswordInput } from '../components/PasswordInput';
import { Alert } from '../components/Alert';

import { evaluatePassword, validateGmail, validateInternationalName } from '../utils/validation';

export const RegisterPage = () => {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const [fieldErrors, setFieldErrors] = useState({});
  const [generalError, setGeneralError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Live password criteria check using shared browser-safe utility
  const { criteria: passwordCriteria, isValid: isPasswordValid, errorMessage: passwordValidationError } =
    evaluatePassword(formData.password);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    // Clear related field error on edit
    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: '' }));
    }
    if (generalError) {
      setGeneralError('');
    }
  };

  const validateClient = () => {
    const errors = {};

    const nameCheck = validateInternationalName(formData.name);
    if (!nameCheck.isValid) {
      errors.name = nameCheck.errorMessage;
    }

    const emailCheck = validateGmail(formData.email);
    if (!emailCheck.isValid) {
      errors.email = emailCheck.errorMessage;
    }

    if (!formData.password) {
      errors.password = 'Password is required.';
    } else if (!isPasswordValid) {
      errors.password = passwordValidationError;
    }

    if (!formData.confirmPassword) {
      errors.confirmPassword = 'Please confirm your password.';
    } else if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGeneralError('');

    if (!validateClient()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await authService.register({
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
        confirmPassword: formData.confirmPassword,
      });

      // Navigate to OTP verification page with state
      navigate('/verify-otp', {
        state: {
          email: formData.email.trim().toLowerCase(),
          name: formData.name.trim(),
          message: response.message || 'Verification code sent to your Gmail address.',
        },
      });
    } catch (err) {
      if (err.data?.errors) {
        // Map backend validation errors to fields
        const backendErrors = {};
        err.data.errors.forEach((item) => {
          backendErrors[item.field] = item.message;
        });
        setFieldErrors(backendErrors);
      }
      setGeneralError(err.message || 'Registration failed. Please check the form and try again.');
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
          <div className="auth-tag">Student Registration</div>
          <h1 className="auth-title">Create your account</h1>
          <p className="auth-subtitle">
            Join the campus peer-to-peer textbook network using your personal Gmail.
          </p>
        </div>

        {generalError && <Alert type="error" message={generalError} onDismiss={() => setGeneralError('')} />}

        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          {/* Full Name */}
          <div className={`form-group ${fieldErrors.name ? 'has-error' : ''}`}>
            <label htmlFor="name" className="form-label">
              Full Name <span className="required-indicator" aria-hidden="true">*</span>
            </label>
            <div className="input-wrapper">
              <User className="input-icon-left" size={18} aria-hidden="true" />
              <input
                id="name"
                name="name"
                type="text"
                value={formData.name}
                onChange={handleChange}
                placeholder="Alex Morgan"
                required
                autoComplete="name"
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={fieldErrors.name ? 'name-error' : undefined}
                className="form-input with-left-icon"
                disabled={isSubmitting}
              />
            </div>
            {fieldErrors.name && (
              <span id="name-error" className="field-error-text" role="alert">
                {fieldErrors.name}
              </span>
            )}
          </div>

          {/* Personal Gmail */}
          <div className={`form-group ${fieldErrors.email ? 'has-error' : ''}`}>
            <label htmlFor="email" className="form-label">
              Personal Gmail Address <span className="required-indicator" aria-hidden="true">*</span>
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
                aria-describedby={fieldErrors.email ? 'email-error' : 'email-helper'}
                className="form-input with-left-icon"
                disabled={isSubmitting}
              />
            </div>
            {fieldErrors.email ? (
              <span id="email-error" className="field-error-text" role="alert">
                {fieldErrors.email}
              </span>
            ) : (
              <span id="email-helper" className="field-helper-text">
                Verification code will be sent to this Gmail address.
              </span>
            )}
          </div>

          {/* Password */}
          <PasswordInput
            id="password"
            name="password"
            label="Password"
            value={formData.password}
            onChange={handleChange}
            placeholder="Create a strong password"
            error={fieldErrors.password}
            disabled={isSubmitting}
            autoComplete="new-password"
            required
          />

          {/* Password Strength Requirements Helper */}
          {formData.password && (
            <div className="password-checklist" aria-live="polite">
              <span className="checklist-label">Security Requirements:</span>
              <div className="criteria-grid">
                <span className={`criterion-item ${passwordCriteria.length ? 'met' : ''}`}>
                  <Check size={13} className="check-icon" aria-hidden="true" /> 8-72 characters
                </span>
                <span className={`criterion-item ${passwordCriteria.upper ? 'met' : ''}`}>
                  <Check size={13} className="check-icon" aria-hidden="true" /> Uppercase letter
                </span>
                <span className={`criterion-item ${passwordCriteria.lower ? 'met' : ''}`}>
                  <Check size={13} className="check-icon" aria-hidden="true" /> Lowercase letter
                </span>
                <span className={`criterion-item ${passwordCriteria.number ? 'met' : ''}`}>
                  <Check size={13} className="check-icon" aria-hidden="true" /> Number (0-9)
                </span>
                <span className={`criterion-item ${passwordCriteria.special ? 'met' : ''}`}>
                  <Check size={13} className="check-icon" aria-hidden="true" /> Special character (!@#$)
                </span>
              </div>
            </div>
          )}

          {/* Confirm Password */}
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            label="Confirm Password"
            value={formData.confirmPassword}
            onChange={handleChange}
            placeholder="Repeat password"
            error={fieldErrors.confirmPassword}
            disabled={isSubmitting}
            autoComplete="new-password"
            required
          />

          {/* Submit Button */}
          <button
            type="submit"
            className="btn-primary btn-block"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={18} className="spinner" aria-hidden="true" />
                <span>Creating Registration...</span>
              </>
            ) : (
              <>
                <span>Continue to Email Verification</span>
                <ArrowRight size={18} aria-hidden="true" />
              </>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Already have an active account?{' '}
            <Link to="/login" className="auth-link">
              Log In here
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};
