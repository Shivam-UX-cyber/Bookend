/**
 * Central API client with normalized ApiError class and credentials: 'include' for HTTP-only cookies
 */

const rawBaseUrl = import.meta.env?.VITE_API_BASE_URL || '';
const API_BASE_URL = rawBaseUrl.replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message, status = 0, data = null, errorFlags = {}) {
    super(message || 'An unexpected error occurred.');
    this.name = 'ApiError';
    this.status = status;
    this.data = data || {};
    // Backward compatibility for code accessing err.response?.status or err.response?.data
    this.response = { status, data: this.data };

    this.isAborted = Boolean(errorFlags.isAborted || this.data?.isAborted);
    this.isTimeout = Boolean(errorFlags.isTimeout || this.data?.isTimeout);
    this.isValidationError = status === 400;
    this.isAuthError = status === 401;
    this.isForbidden = status === 403;
    this.isNotFound = status === 404;
    this.isConflict = status === 409;
    this.isRateLimited = status === 429;
    this.isServerError = status >= 500;
    // Strictly isolate true offline/network failure from intentional aborts and timeouts
    this.isNetworkError = status === 0 && !this.isAborted && !this.isTimeout;
  }
}

export const apiRequest = async (endpoint, options = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;

  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  };

  // Default timeout of 15000ms unless explicitly disabled with timeout: 0 or timeout: null
  const timeoutMs = options.timeout !== undefined ? options.timeout : 15000;
  const controller = new AbortController();
  let isTimedOut = false;
  let timeoutId = null;

  if (timeoutMs && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      isTimedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  // Link caller signal if provided
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  const { timeout: _unusedTimeout, signal: _unusedSignal, ...restOptions } = options;

  const config = {
    ...restOptions,
    signal: controller.signal,
    credentials: 'include', // Ensures HTTP-only cookies are included in requests
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  };

  try {
    const response = await fetch(url, config);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data.message || `Request failed with HTTP status ${response.status}`;
      throw new ApiError(message, response.status, data);
    }

    return data;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (isTimedOut) {
      throw new ApiError(
        'Request timed out. Please check your connection and try again.',
        0,
        { isTimeout: true },
        { isTimeout: true }
      );
    }

    if (error.name === 'AbortError') {
      throw new ApiError('Request was cancelled.', 0, { isAborted: true }, { isAborted: true });
    }

    // Network disconnection, offline, DNS, or CORS failure
    throw new ApiError(
      'Unable to connect to the server. Please check your internet connection.',
      0,
      { originalMessage: error.message }
    );
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};
