import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Compass, ArrowLeft, Home } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const NotFoundPage = () => {
  const { isAuthenticated } = useAuth();

  return (
    <div className="auth-page-container">
      <div className="auth-card-wrapper text-center">
        <div className="auth-icon-badge not-found-badge">
          <Compass size={32} className="text-primary" aria-hidden="true" />
        </div>
        <div className="auth-tag">404 Error</div>
        <h1 className="auth-title">Page Not Found</h1>
        <p className="auth-subtitle">
          The requested address does not exist on the Campus Book Exchange portal. It may have moved or was mistyped.
        </p>

        <div className="not-found-actions">
          <Link to="/books" className="btn-primary btn-block mb-3">
            <BookOpen size={18} aria-hidden="true" />
            <span>Browse Book Marketplace</span>
          </Link>

          {isAuthenticated ? (
            <Link to="/dashboard" className="btn-secondary btn-block">
              <Home size={18} aria-hidden="true" />
              <span>Go to Dashboard</span>
            </Link>
          ) : (
            <Link to="/login" className="btn-secondary btn-block">
              <ArrowLeft size={18} aria-hidden="true" />
              <span>Back to Login</span>
            </Link>
          )}

          <div className="not-found-sublinks mt-4">
            <Link to="/register" className="auth-link-subtle">
              Need an account? Register here
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
