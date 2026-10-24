import React, { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';

export const PasswordInput = ({
  id,
  name,
  label,
  value,
  onChange,
  placeholder = '••••••••',
  error,
  helperText,
  disabled = false,
  autoComplete = 'current-password',
  required = false,
}) => {
  const [showPassword, setShowPassword] = useState(false);

  const toggleVisibility = () => {
    setShowPassword((prev) => !prev);
  };

  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;
  const describedBy = error ? errorId : helperText ? helperId : undefined;

  return (
    <div className={`form-group ${error ? 'has-error' : ''}`}>
      {label && (
        <label htmlFor={id} className="form-label">
          {label} {required && <span className="required-indicator" aria-hidden="true">*</span>}
        </label>
      )}
      <div className="input-wrapper">
        <Lock className="input-icon-left" size={18} aria-hidden="true" />
        <input
          id={id}
          name={name}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className="form-input with-left-icon with-right-btn"
        />
        <button
          type="button"
          onClick={toggleVisibility}
          className="input-toggle-btn"
          disabled={disabled}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          aria-pressed={showPassword}
          title={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
      {error ? (
        <span id={errorId} className="field-error-text" role="alert">
          {error}
        </span>
      ) : helperText ? (
        <span id={helperId} className="field-helper-text">
          {helperText}
        </span>
      ) : null}
    </div>
  );
};
