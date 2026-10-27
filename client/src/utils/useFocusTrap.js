import { useEffect, useRef } from 'react';

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Custom hook to trap keyboard focus within modal dialogs and restore focus on close.
 * Conforms to WCAG 2.1 Criteria 2.1.2 (No Keyboard Trap) and 2.4.3 (Focus Order).
 *
 * @param {boolean} isActive - Whether the trap is active
 * @param {React.RefObject} initialFocusRef - Optional element to receive initial focus
 * @returns {React.RefObject} containerRef - Attach to modal dialog root
 */
export const useFocusTrap = (isActive = true, initialFocusRef = null) => {
  const containerRef = useRef(null);
  const previousActiveElementRef = useRef(null);

  useEffect(() => {
    if (!isActive) return;

    // Cache the currently focused trigger element before opening
    previousActiveElementRef.current = document.activeElement;

    const container = containerRef.current;
    if (!container) return;

    // Move initial focus
    const focusTimer = setTimeout(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
      } else {
        const focusable = container.querySelectorAll(FOCUSABLE_SELECTOR);
        if (focusable.length > 0) {
          focusable[0].focus();
        }
      }
    }, 50);

    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return;

      const focusableElements = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null && window.getComputedStyle(el).visibility !== 'hidden'
      );

      if (focusableElements.length === 0) {
        e.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        // Shift + Tab (Backwards)
        if (document.activeElement === firstElement || !container.contains(document.activeElement)) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab (Forwards)
        if (document.activeElement === lastElement || !container.contains(document.activeElement)) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus to trigger element on dismiss
      if (previousActiveElementRef.current && typeof previousActiveElementRef.current.focus === 'function') {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isActive, initialFocusRef]);

  return containerRef;
};
