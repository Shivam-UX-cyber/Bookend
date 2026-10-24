import React from 'react';
import { AlertCircle, CheckCircle2, Info, AlertTriangle, X } from 'lucide-react';

export const Alert = ({ type = 'info', message, onDismiss, className = '' }) => {
  if (!message) return null;

  const icons = {
    error: <AlertCircle className="alert-icon error" size={20} aria-hidden="true" />,
    success: <CheckCircle2 className="alert-icon success" size={20} aria-hidden="true" />,
    info: <Info className="alert-icon info" size={20} aria-hidden="true" />,
    warning: <AlertTriangle className="alert-icon warning" size={20} aria-hidden="true" />,
  };

  return (
    <div
      className={`alert-banner alert-${type} ${className}`}
      role="alert"
      aria-live={type === 'error' ? 'assertive' : 'polite'}
    >
      <div className="alert-content">
        {icons[type]}
        <div className="alert-message">{message}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="alert-dismiss-btn"
          aria-label="Dismiss alert"
          title="Dismiss alert"
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
};
