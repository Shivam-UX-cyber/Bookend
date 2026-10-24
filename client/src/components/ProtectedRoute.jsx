import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BookOpen, ShieldAlert, RefreshCw } from 'lucide-react';

export const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading, authStatus, authError, checkAuthStatus } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="auth-loading-screen" role="status" aria-live="polite">
        <div className="loading-card">
          <div className="spinner-orbit">
            <BookOpen size={28} className="pulse-icon" />
          </div>
          <p className="loading-text">Verifying secure session...</p>
        </div>
      </div>
    );
  }

  // Handle network / server failure without prematurely bouncing the user or clearing session
  if (authStatus === 'network_error' || authStatus === 'server_error') {
    return (
      <div className="auth-loading-screen" role="alert" aria-live="assertive">
        <div className="loading-card error-card">
          <ShieldAlert size={36} className="text-warning mb-3" />
          <h2 className="card-title mb-2">Connection Problem</h2>
          <p className="card-desc mb-4">
            {authError || 'Could not reach the authentication server. Your login session is preserved.'}
          </p>
          <button
            type="button"
            onClick={() => checkAuthStatus()}
            className="btn-primary"
          >
            <RefreshCw size={16} />
            <span>Retry Connection</span>
          </button>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};
