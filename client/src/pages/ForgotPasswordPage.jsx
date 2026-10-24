import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, KeyRound, CheckCircle2, ArrowLeft, ArrowRight, Loader2, RefreshCw, Check, ShieldCheck, Lock } from 'lucide-react';
import { authService } from '../services/authService';
import { OtpInput } from '../components/OtpInput';
import { PasswordInput } from '../components/PasswordInput';
import { Alert } from '../components/Alert';
import { evaluatePassword, validateGmail, calculateRemainingCooldown } from '../utils/validation';

const STEPS = {
  EMAIL: 1,
  OTP: 2,
  NEW_PASSWORD: 3,
};

export const ForgotPasswordPage = () => {
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState(STEPS.EMAIL);
  const [email, setEmail] = useState('');
  const [otpDigits, setOtpDigits] = useState(Array(6).fill(''));
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [countdown, setCountdown] = useState(0); // Backend-authoritative cooldown
  const cooldownDeadlineRef = useRef(0);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Browser-safe live password criteria check (No Buffer used)
  const { criteria: passwordCriteria, isValid: isPasswordValid, errorMessage: passwordValidationError } =
    evaluatePassword(newPassword);

  const isOtpComplete = otpDigits.every((d) => d && d.trim().length === 1);
  const fullOtpString = otpDigits.join('');

  // Restore recovery flow and server cooldown on page mount or refresh
  useEffect(() => {
    let isMounted = true;

    const restoreFlow = async () => {
      try {
        const status = await authService.getForgotPasswordStatus();
        if (!isMounted) return;

        if (status.active) {
          if (status.email) {
            setEmail(status.email);
          }
          if (status.step === STEPS.OTP) {
            setCurrentStep(STEPS.OTP);
            const seconds = status.cooldownSeconds ?? 0;
            if (seconds > 0) {
              cooldownDeadlineRef.current = Date.now() + seconds * 1000;
              setCountdown(seconds);
            }
            if (status.deliveryFailed) {
              setErrorMessage('Verification email could not be delivered. You may request a new code immediately.');
              setCountdown(0);
              cooldownDeadlineRef.current = 0;
            } else if (status.isExpired) {
              setErrorMessage('Your password reset code has expired. Please request a new code.');
            }
          } else if (status.step === STEPS.NEW_PASSWORD) {
            setCurrentStep(STEPS.NEW_PASSWORD);
          }
        } else if (status.message) {
          setErrorMessage(status.message);
          setCurrentStep(STEPS.EMAIL);
        }
      } catch (err) {
        if (!isMounted) return;
        console.warn('[Forgot Password Flow Check Failed]', err.message);
      }
    };

    restoreFlow();

    return () => {
      isMounted = false;
    };
  }, []);

  // Deadline-based cooldown timer effect with visibility change reconciliation
  useEffect(() => {
    if (countdown <= 0) return;

    const tick = () => {
      const remaining = calculateRemainingCooldown(cooldownDeadlineRef.current);
      setCountdown(remaining);
    };

    const intervalId = setInterval(tick, 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        tick();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [countdown]);

  // Track active async operation ID to ignore stale responses
  const activeOpIdRef = useRef(0);

  // Step 1: Submit Email
  const handleRequestOtp = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    setErrorMessage('');
    setSuccessMessage('');

    const emailCheck = validateGmail(email);
    if (!emailCheck.isValid) {
      setErrorMessage(emailCheck.errorMessage);
      return;
    }

    const opId = ++activeOpIdRef.current;
    setIsSubmitting(true);
    try {
      const response = await authService.forgotPassword(emailCheck.normalizedEmail);
      if (opId !== activeOpIdRef.current) return;

      if (response.deliveryFailed) {
        setErrorMessage('We had trouble delivering the email to your inbox. You may request a new code immediately.');
        setCountdown(0);
        cooldownDeadlineRef.current = 0;
      } else {
        setSuccessMessage(response.message || 'If an account exists, a 6-digit reset code has been sent.');
        const cooldownSecs = response.cooldownSeconds || 60;
        cooldownDeadlineRef.current = Date.now() + cooldownSecs * 1000;
        setCountdown(cooldownSecs);
      }
      setOtpDigits(Array(6).fill(''));
      setCurrentStep(STEPS.OTP);
    } catch (err) {
      if (opId !== activeOpIdRef.current) return;
      setErrorMessage(err.message || 'Failed to process password reset request. Please try again.');
    } finally {
      if (opId === activeOpIdRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  // Step 2: Verify OTP
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (isSubmitting || isResending) return;

    setErrorMessage('');
    setSuccessMessage('');

    if (!isOtpComplete || fullOtpString.length !== 6) {
      setErrorMessage('Please enter the complete 6-digit verification code.');
      return;
    }

    const opId = ++activeOpIdRef.current;
    setIsSubmitting(true);
    try {
      const response = await authService.verifyResetOtp(fullOtpString);
      if (opId !== activeOpIdRef.current) return;

      setSuccessMessage(response.message || 'Code verified successfully! Now set your new password.');
      setCurrentStep(STEPS.NEW_PASSWORD);
    } catch (err) {
      if (opId !== activeOpIdRef.current) return;
      setErrorMessage(err.message || 'Invalid or expired verification code.');
    } finally {
      if (opId === activeOpIdRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  // Resend OTP in Step 2
  const handleResendOtp = async () => {
    if (countdown > 0 || isResending || isSubmitting) return;

    setErrorMessage('');
    setSuccessMessage('');

    const opId = ++activeOpIdRef.current;
    setIsResending(true);

    try {
      const response = await authService.resendResetOtp();
      if (opId !== activeOpIdRef.current) return;

      if (response.deliveryFailed) {
        setErrorMessage('Email delivery could not be completed. You can try resending again.');
        setCountdown(0);
        cooldownDeadlineRef.current = 0;
      } else {
        setSuccessMessage(response.message || 'A new reset code has been sent.');
        const cooldownSecs = response.cooldownSeconds || 60;
        cooldownDeadlineRef.current = Date.now() + cooldownSecs * 1000;
        setCountdown(cooldownSecs);
      }
      setOtpDigits(Array(6).fill(''));
    } catch (err) {
      if (opId !== activeOpIdRef.current) return;
      if (err.data?.retryAfter) {
        cooldownDeadlineRef.current = Date.now() + err.data.retryAfter * 1000;
        setCountdown(err.data.retryAfter);
      }
      setErrorMessage(err.message || 'Failed to resend code. Please try again.');
    } finally {
      if (opId === activeOpIdRef.current) {
        setIsResending(false);
      }
    }
  };

  // Change Email Action (safely cancels current flow and cleans cookies)
  const handleChangeEmail = async () => {
    try {
      await authService.cancelForgotPassword();
    } catch {
      // Fallback silently if session was already gone
    }
    setOtpDigits(Array(6).fill(''));
    setCountdown(0);
    cooldownDeadlineRef.current = 0;
    setErrorMessage('');
    setSuccessMessage('');
    setCurrentStep(STEPS.EMAIL);
  };

  // Step 3: Set New Password (No raw tokens in client JavaScript)
  const handleResetPassword = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!isPasswordValid) {
      setErrorMessage(passwordValidationError || 'New password does not meet required security standards.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await authService.resetPassword(newPassword, confirmPassword);

      navigate('/login', {
        state: {
          successMessage: response.message || 'Password reset successfully! Please log in with your new password.',
          prefillEmail: email.trim().toLowerCase(),
        },
      });
    } catch (err) {
      setErrorMessage(err.message || 'Failed to reset password. Please restart the request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-page-container">
      <div className="auth-card-wrapper">
        {/* Step Indicator Header */}
        <div className="wizard-stepper" aria-label="Password recovery steps">
          <div
            className={`step-node ${currentStep >= STEPS.EMAIL ? 'active' : ''} ${currentStep > STEPS.EMAIL ? 'done' : ''}`}
            aria-current={currentStep === STEPS.EMAIL ? 'step' : undefined}
          >
            <span aria-hidden="true">1</span>
            <small>Request</small>
          </div>
          <div className={`step-connector ${currentStep > STEPS.EMAIL ? 'active' : ''}`} aria-hidden="true" />
          <div
            className={`step-node ${currentStep >= STEPS.OTP ? 'active' : ''} ${currentStep > STEPS.OTP ? 'done' : ''}`}
            aria-current={currentStep === STEPS.OTP ? 'step' : undefined}
          >
            <span aria-hidden="true">2</span>
            <small>Verify Code</small>
          </div>
          <div className={`step-connector ${currentStep > STEPS.OTP ? 'active' : ''}`} aria-hidden="true" />
          <div
            className={`step-node ${currentStep >= STEPS.NEW_PASSWORD ? 'active' : ''}`}
            aria-current={currentStep === STEPS.NEW_PASSWORD ? 'step' : undefined}
          >
            <span aria-hidden="true">3</span>
            <small>New Password</small>
          </div>
        </div>

        {/* Step 1: Email Request */}
        {currentStep === STEPS.EMAIL && (
          <div>
            <div className="auth-header">
              <div className="auth-icon-badge" aria-hidden="true">
                <Lock size={26} className="text-primary" />
              </div>
              <div className="auth-tag">Step 1 of 3</div>
              <h1 className="auth-title">Reset your password</h1>
              <p className="auth-subtitle">
                Enter your registered Gmail address. We will send you a 6-digit recovery code.
              </p>
            </div>

            {errorMessage && <Alert type="error" message={errorMessage} onDismiss={() => setErrorMessage('')} />}
            {successMessage && <Alert type="success" message={successMessage} onDismiss={() => setSuccessMessage('')} />}

            <form onSubmit={handleRequestOtp} className="auth-form" noValidate>
              <div className="form-group">
                <label htmlFor="recoveryEmail" className="form-label">
                  Registered Gmail Address <span className="required-indicator" aria-hidden="true">*</span>
                </label>
                <div className="input-wrapper">
                  <Mail className="input-icon-left" size={18} aria-hidden="true" />
                  <input
                    id="recoveryEmail"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="student.name@gmail.com"
                    required
                    autoComplete="email"
                    className="form-input with-left-icon"
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn-primary btn-block"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={18} className="spinner" aria-hidden="true" />
                    <span>Sending Reset Code...</span>
                  </>
                ) : (
                  <>
                    <span>Send Verification Code</span>
                    <ArrowRight size={18} aria-hidden="true" />
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* Step 2: OTP Verification */}
        {currentStep === STEPS.OTP && (
          <div>
            <div className="auth-header">
              <div className="auth-icon-badge" aria-hidden="true">
                <KeyRound size={26} className="text-primary" />
              </div>
              <div className="auth-tag">Step 2 of 3</div>
              <h1 className="auth-title">Enter reset code</h1>
              <p className="auth-subtitle">
                We sent a 6-digit password reset code to:
                <br />
                <strong className="email-highlight">{email}</strong>
              </p>
            </div>

            {errorMessage && <Alert type="error" message={errorMessage} onDismiss={() => setErrorMessage('')} />}
            {successMessage && <Alert type="success" message={successMessage} onDismiss={() => setSuccessMessage('')} />}

            <form onSubmit={handleVerifyOtp} className="auth-form" noValidate>
              <div className="form-group">
                <label className="form-label text-center block">
                  6-Digit Recovery Code <span className="required-indicator" aria-hidden="true">*</span>
                </label>
                <OtpInput
                  length={6}
                  value={otpDigits}
                  onChange={setOtpDigits}
                  disabled={isSubmitting}
                  error={Boolean(errorMessage)}
                />
                <span className="field-helper-text text-center block mt-2">
                  Code expires in <strong>5 minutes</strong>. Check your spam folder if not received.
                </span>
              </div>

              <button
                type="submit"
                className="btn-primary btn-block"
                disabled={isSubmitting || !isOtpComplete}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={18} className="spinner" aria-hidden="true" />
                    <span>Verifying Code...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={18} aria-hidden="true" />
                    <span>Verify Code</span>
                  </>
                )}
              </button>
            </form>

            <div className="otp-actions-bar">
              <div className="resend-control">
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={countdown > 0 || isResending}
                  className="btn-link-resend"
                  aria-label={countdown > 0 ? `Resend code available in ${countdown} seconds` : 'Resend reset code'}
                >
                  <RefreshCw size={14} className={isResending ? 'spinner' : ''} aria-hidden="true" />
                  {countdown > 0 ? (
                    <span>Resend code in <strong>{countdown}s</strong></span>
                  ) : (
                    <span>Resend reset code</span>
                  )}
                </button>
              </div>

              <div className="back-to-register">
                <button
                  type="button"
                  onClick={handleChangeEmail}
                  className="btn-link-back"
                >
                  <ArrowLeft size={14} aria-hidden="true" />
                  <span>Change email address</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: New Password */}
        {currentStep === STEPS.NEW_PASSWORD && (
          <div>
            <div className="auth-header">
              <div className="auth-icon-badge" aria-hidden="true">
                <ShieldCheck size={28} className="text-primary" />
              </div>
              <div className="auth-tag">Step 3 of 3</div>
              <h1 className="auth-title">Choose a new password</h1>
              <p className="auth-subtitle">
                Email verified. Create a strong new password for your account.
              </p>
            </div>

            {errorMessage && <Alert type="error" message={errorMessage} onDismiss={() => setErrorMessage('')} />}
            {successMessage && <Alert type="success" message={successMessage} onDismiss={() => setSuccessMessage('')} />}

            <form onSubmit={handleResetPassword} className="auth-form" noValidate>
              <PasswordInput
                id="newPassword"
                name="newPassword"
                label="New Password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                disabled={isSubmitting}
                autoComplete="new-password"
                required
              />

              {/* Checklist */}
              {newPassword && (
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

              <PasswordInput
                id="confirmPassword"
                name="confirmPassword"
                label="Confirm New Password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                disabled={isSubmitting}
                autoComplete="new-password"
                required
              />

              <button
                type="submit"
                className="btn-primary btn-block"
                disabled={isSubmitting || !isPasswordValid || newPassword !== confirmPassword}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={18} className="spinner" aria-hidden="true" />
                    <span>Updating Password...</span>
                  </>
                ) : (
                  <>
                    <KeyRound size={18} aria-hidden="true" />
                    <span>Reset Password & Log In</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        <div className="auth-footer">
          <p>
            Remember your credentials?{' '}
            <Link to="/login" className="auth-link">
              Back to Login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};
