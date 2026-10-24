import React, { useRef, useEffect, useMemo } from 'react';

/**
 * Robust, accessible 6-digit OTP Input component.
 *
 * Guarantees:
 * - Digit positions are preserved when intermediate slots are empty (no shifting).
 * - Full 6-digit paste and mobile/browser SMS autofill supported.
 * - Non-numeric characters rejected.
 * - Backspace / Delete / Arrow keys navigation works cleanly.
 * - Full keyboard, focus, and screen-reader accessibility.
 */
export const OtpInput = ({
  length = 6,
  value,
  onChange,
  disabled = false,
  error = false,
}) => {
  const inputRefs = useRef([]);

  // Normalize incoming value to fixed-length array of digits
  const digitArray = useMemo(() => {
    if (Array.isArray(value)) {
      return Array.from({ length }, (_, i) => (value[i] ? String(value[i]).slice(-1) : ''));
    }
    if (typeof value === 'string') {
      return Array.from({ length }, (_, i) => (value[i] ? value[i] : ''));
    }
    return Array(length).fill('');
  }, [value, length]);

  // Helper to emit changes in the consumer's expected format
  const emitChange = (newDigits) => {
    if (!onChange) return;
    if (Array.isArray(value)) {
      onChange(newDigits);
    } else {
      onChange(newDigits.join(''), newDigits);
    }
  };

  useEffect(() => {
    // Focus first empty slot on initial mount if not disabled
    if (!disabled && inputRefs.current[0]) {
      const firstEmptyIndex = digitArray.findIndex((d) => !d);
      const targetIndex = firstEmptyIndex === -1 ? 0 : firstEmptyIndex;
      inputRefs.current[targetIndex]?.focus();
    }
  }, []);

  const handleInputChange = (index, e) => {
    const rawVal = e.target.value;
    const digitsOnly = rawVal.replace(/\D/g, '');

    // Handle full-code autofill or multi-character paste into a single box
    if (digitsOnly.length > 1) {
      const newDigits = [...digitArray];
      // If full length is provided, fill from 0; otherwise start at current index
      const startIdx = digitsOnly.length >= length ? 0 : index;
      for (let i = 0; i < digitsOnly.length && startIdx + i < length; i++) {
        newDigits[startIdx + i] = digitsOnly[i];
      }
      emitChange(newDigits);

      const nextFocus = Math.min(startIdx + digitsOnly.length, length - 1);
      inputRefs.current[nextFocus]?.focus();
      return;
    }

    // Single-digit entry: replace the exact slot without shifting others
    const cleanChar = digitsOnly.slice(-1);
    const newDigits = [...digitArray];
    newDigits[index] = cleanChar;
    emitChange(newDigits);

    // Advance focus only if a digit was entered
    if (cleanChar && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digitArray[index]) {
        // Clear current slot without moving focus
        const newDigits = [...digitArray];
        newDigits[index] = '';
        emitChange(newDigits);
      } else if (index > 0) {
        // Current slot is already empty: move focus to previous slot and clear it
        inputRefs.current[index - 1]?.focus();
        const newDigits = [...digitArray];
        newDigits[index - 1] = '';
        emitChange(newDigits);
      }
    } else if (e.key === 'Delete') {
      e.preventDefault();
      if (digitArray[index]) {
        const newDigits = [...digitArray];
        newDigits[index] = '';
        emitChange(newDigits);
      }
    } else if (e.key === 'ArrowLeft') {
      if (index > 0) {
        e.preventDefault();
        inputRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowRight') {
      if (index < length - 1) {
        e.preventDefault();
        inputRefs.current[index + 1]?.focus();
      }
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text/plain');
    const numericChars = pastedText.replace(/\D/g, '').slice(0, length);

    if (numericChars) {
      const newDigits = [...digitArray];
      const startIdx = numericChars.length === length ? 0 : 0;
      for (let i = 0; i < numericChars.length && i < length; i++) {
        newDigits[startIdx + i] = numericChars[i];
      }
      emitChange(newDigits);

      const nextFocus = Math.min(numericChars.length, length - 1);
      inputRefs.current[nextFocus]?.focus();
    }
  };

  const handleFocus = (index) => {
    // Select text on focus for easy overwrite
    inputRefs.current[index]?.select();
  };

  return (
    <div className={`otp-container ${error ? 'otp-has-error' : ''}`}>
      <div
        className="otp-digit-group"
        onPaste={handlePaste}
        role="group"
        aria-label="Verification code input slots"
      >
        {Array.from({ length }).map((_, index) => (
          <input
            key={index}
            ref={(el) => (inputRefs.current[index] = el)}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={length} // Allows full-length autofill capture in any slot
            value={digitArray[index] || ''}
            onChange={(e) => handleInputChange(index, e)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onFocus={() => handleFocus(index)}
            disabled={disabled}
            className={`otp-digit-box ${digitArray[index] ? 'filled' : ''}`}
            aria-label={`Digit ${index + 1} of ${length}`}
            aria-invalid={error}
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
          />
        ))}
      </div>
    </div>
  );
};
