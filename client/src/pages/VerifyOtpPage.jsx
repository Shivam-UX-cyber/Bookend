import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { MailCheck, RefreshCw, ArrowLeft, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import { authService } from '../services/authService';
import { OtpInput } from '../components/OtpInput';
import { Alert } from '../components/Alert';
import { calculateRemainingCooldown } from '../utils/validation';

export const VerifyOtpPage = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // Retrieve initial email from location state or query params
  const searchParams = new URLSearchParams(location.search);
  const emailFromQuery = searchParams.get('email') || '';
  const initialEmail = location.state?.email || emailFromQuery;

  const [email, setEmail] = useState(initialEmail);
  const [otpDigits, setOtpDigits] = useState(Array(6).fill(''));
  const [countdown, setCountdown] = useState(0); // Backend-authoritative cooldown
  const cooldownDeadlineRef = useRef(0);

  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState(location.state?.message || '');

  const isOtpComplete = otpDigits.every((d) => d && d.trim().length === 1);
  const fullOtpString = otpDigits.join('');

  // Synchronize flow state and server cooldown on mount / refresh
  useEffect(() => {
    let isMounted = true;

    const fetchStatus = async () => {
      try {
        const status = await authService.getRegistrationStatus();
        if (!isMounted) return;

        if (status.active && status.email) {
          setEmail(status.email);
          const seconds = status.cooldownSeconds ?? 0;
          if (seconds > 0) {
            cooldownDeadlineRef.current = Date.now() + seconds * 1000;
            setCountdown(seconds);
          }
          if (status.isExpired) {
            setErrorMessage('Your verification code has expired. Please request a new code.');
          }
        } else if (!email) {
          setCountdown(0);
        }
      } catch (err) {
        if (!isMounted) return;
        console.warn('[Registration Status Check Failed]', err.message);
      } finally {
        if (isMounted) setIsLoadingStatus(false);
      }
    };

    fetchStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  // Deadline-based countdown timer effect with visibility change handling
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

  const handleVerify = async (e) => {
    e?.preventDefault();
    if (isVerifying || isResending) return;

    setErrorMessage('');
    setSuccessMessage('');

    if (!isOtpComplete || fullOtpString.length !== 6) {
      setErrorMessage('Please enter all 6 digits of the verification code.');
      return;
    }

    const opId = ++activeOpIdRef.current;
    setIsVerifying(true);

    try {
      const response = await authService.verifyRegistrationOtp(fullOtpString);
      if (opId !== activeOpIdRef.current) return;

      navigate('/login', {
        state: {
          successMessage: response.message || 'Account activated successfully! Please log in.',
          prefillEmail: email,
        },
      });
    } catch (err) {
      if (opId !== activeOpIdRef.current) return;
      setErrorMessage(err.message || 'Verification failed. Please check the code and try again.');
    } finally {
      if (opId === activeOpIdRef.current) {
        setIsVerifying(false);
      }
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || isResending || isVerifying) return;

    setErrorMessage('');
    setSuccessMessage('');

    const opId = ++activeOpIdRef.current;
    setIsResending(true);

    try {
      const response = await authService.resendRegistrationOtp();
      if (opId !== activeOpIdRef.current) return;

      setSuccessMessage(response.message || 'A new verification code has been dispatched.');
      const cooldownSecs = response.cooldownSeconds || 60;
      cooldownDeadlineRef.current = Date.now() + cooldownSecs * 1000;
      setCountdown(cooldownSecs);
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

  const handleCancelRegistration = async () => {
    try {
      await authService.cancelRegistration();
    } catch {
      // Best-effort cancellation
    }
    navigate('/register');
  };

  if (!email && !isLoadingStatus) {
    return (
      <div className="auth-page-container">
        <div className="auth-card-wrapper text-center">
          <div className="auth-icon-badge" aria-hidden="true">
            <ShieldAlert size={32} className="text-warning" />
          </div>
          <div className="auth-tag">Session Missing</div>
          <h2 className="auth-title">Registration Session Not Found</h2>
          <p className="auth-subtitle">
            No active email verification session was located. Please begin registration to receive a verification code.
          </p>
          <Link to="/register" className="btn-primary mt-6 inline-flex">
            Go to Registration
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page-container">
      <div className="auth-card-wrapper">
        <div className="auth-header">
          <div className="auth-icon-badge" aria-hidden="true">
            <MailCheck size={28} className="text-primary" />
          </div>
          <div className="auth-tag">Verification Required</div>
          <h1 className="auth-title">Verify your email</h1>
          <p className="auth-subtitle">
            We sent a 6-digit confirmation code to:
            <br />
            <strong className="email-highlight">{email}</strong>
          </p>
        </div>

        {errorMessage && <Alert type="error" message={errorMessage} onDismiss={() => setErrorMessage('')} />}
        {successMessage && <Alert type="success" message={successMessage} onDismiss={() => setSuccessMessage('')} />}

        <form onSubmit={handleVerify} className="auth-form" noValidate>
          <div className="form-group">
            <label className="form-label text-center block">
              Enter 6-Digit Code <span className="required-indicator" aria-hidden="true">*</span>
            </label>
            <OtpInput
              length={6}
              value={otpDigits}
              onChange={setOtpDigits}
              disabled={isVerifying}
              error={Boolean(errorMessage)}
            />
            <span className="field-helper-text text-center block mt-2">
              Code expires in <strong>5 minutes</strong>. If not in your inbox, please inspect your spam folder.
            </span>
          </div>

          <button
            type="submit"
            className="btn-primary btn-block"
            disabled={isVerifying || !isOtpComplete}
            aria-busy={isVerifying}
          >
            {isVerifying ? (
              <>
                <Loader2 size={18} className="spinner" aria-hidden="true" />
                <span>Verifying Code...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={18} aria-hidden="true" />
                <span>Verify & Activate Account</span>
              </>
            )}
          </button>
        </form>

        <div className="otp-actions-bar">
          <div className="resend-control">
            <button
              type="button"
              onClick={handleResend}
              disabled={countdown > 0 || isResending}
              className="btn-link-resend"
              aria-label={countdown > 0 ? `Resend code available in ${countdown} seconds` : 'Resend verification code'}
            >
              <RefreshCw size={14} className={isResending ? 'spinner' : ''} aria-hidden="true" />
              {countdown > 0 ? (
                <span>Resend code in <strong>{countdown}s</strong></span>
              ) : (
                <span>Resend verification code</span>
              )}
            </button>
          </div>

          <div className="back-to-register">
            <button
              type="button"
              onClick={handleCancelRegistration}
              className="btn-link-back"
            >
              <ArrowLeft size={14} aria-hidden="true" />
              <span>Wrong email? Edit registration</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
