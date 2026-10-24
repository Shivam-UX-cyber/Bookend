import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { authService } from '../services/authService';

const AuthContext = createContext(null);

/**
 * Sanitizes post-login redirect paths to prevent open redirect vulnerabilities
 */
export const getSafeRedirectPath = (targetPath, defaultPath = '/dashboard') => {
  if (!targetPath || typeof targetPath !== 'string') return defaultPath;
  const trimmed = targetPath.trim();
  // Must start with single slash, not double slash (protocol-relative), and not contain scheme separator ':'
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.includes(':')) {
    return trimmed;
  }
  return defaultPath;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState('loading'); // 'loading' | 'authenticated' | 'unauthenticated' | 'network_error' | 'server_error'
  const [authError, setAuthError] = useState(null);

  // Inflight check ref to prevent duplicate concurrent /me calls
  const inFlightCheckRef = useRef(null);

  const checkAuthStatus = useCallback(async () => {
    if (inFlightCheckRef.current) {
      return inFlightCheckRef.current;
    }

    const checkPromise = (async () => {
      try {
        setIsLoading(true);
        const data = await authService.getMe();
        if (data && data.user) {
          setUser(data.user);
          setAuthStatus('authenticated');
          setAuthError(null);
          return data.user;
        } else {
          setUser(null);
          setAuthStatus('unauthenticated');
          return null;
        }
      } catch (err) {
        if (err.isAuthError || err.status === 401 || err.status === 403) {
          // Explicitly unauthenticated by backend
          setUser(null);
          setAuthStatus('unauthenticated');
          setAuthError(null);
        } else if (err.isNetworkError || err.status === 0) {
          // Network failure / server offline
          setAuthStatus('network_error');
          setAuthError('Connection issue: Unable to reach the authentication server.');
          // Do not overwrite user if previously loaded
        } else {
          // 500+ internal server error
          setAuthStatus('server_error');
          setAuthError('Server error: Authentication service is temporarily unavailable.');
        }
        return null;
      } finally {
        setIsLoading(false);
        inFlightCheckRef.current = null;
      }
    })();

    inFlightCheckRef.current = checkPromise;
    return checkPromise;
  }, []);

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  const login = async (email, password) => {
    const data = await authService.login(email, password);
    if (data.user) {
      setUser(data.user);
      setAuthStatus('authenticated');
      setAuthError(null);
    }
    return data;
  };

  const logout = async () => {
    try {
      const res = await authService.logout();
      setUser(null);
      setAuthStatus('unauthenticated');
      setAuthError(null);
      return {
        success: Boolean(res?.success),
        message: res?.message || 'Logged out successfully.',
        invalidatedAllSessions: res?.invalidatedAllSessions ?? false,
      };
    } catch (err) {
      // Clear client state gracefully on failure
      setUser(null);
      setAuthStatus('unauthenticated');
      const errorMsg = err.data?.message || err.message || 'Logout encountered a server issue.';
      setAuthError(errorMsg);
      return { success: false, error: errorMsg, invalidatedAllSessions: false };
    }
  };

  const clearAuthError = () => setAuthError(null);

  const value = {
    user,
    isAuthenticated: Boolean(user) && authStatus === 'authenticated',
    isLoading,
    authStatus,
    authError,
    login,
    logout,
    checkAuthStatus,
    clearAuthError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
