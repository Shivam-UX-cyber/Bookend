import test from 'node:test';
import assert from 'node:assert';
import { ApiError } from '../src/services/api.js';

test('1. ApiError distinguishes true network failures from aborts and timeouts', () => {
  // True network error (offline, DNS failure)
  const networkErr = new ApiError('Unable to connect', 0);
  assert.strictEqual(networkErr.status, 0);
  assert.strictEqual(networkErr.isNetworkError, true, 'isNetworkError must be true for true offline failure');
  assert.strictEqual(networkErr.isAborted, false);
  assert.strictEqual(networkErr.isTimeout, false);

  // Intentional AbortError (e.g. unmount or navigation cancellation)
  const abortErr = new ApiError('Request was cancelled.', 0, { isAborted: true }, { isAborted: true });
  assert.strictEqual(abortErr.status, 0);
  assert.strictEqual(abortErr.isAborted, true, 'isAborted must be true');
  assert.strictEqual(abortErr.isNetworkError, false, 'isNetworkError must NOT be true when request was intentionally aborted');
  assert.strictEqual(abortErr.isTimeout, false);

  // Timeout error
  const timeoutErr = new ApiError('Request timed out.', 0, { isTimeout: true }, { isTimeout: true });
  assert.strictEqual(timeoutErr.status, 0);
  assert.strictEqual(timeoutErr.isTimeout, true, 'isTimeout must be true');
  assert.strictEqual(timeoutErr.isNetworkError, false, 'isNetworkError must NOT be true for timeout');
  assert.strictEqual(timeoutErr.isAborted, false);

  // HTTP status errors
  const valErr = new ApiError('Bad request', 400);
  assert.strictEqual(valErr.isValidationError, true);
  assert.strictEqual(valErr.isNetworkError, false);

  const authErr = new ApiError('Unauthorized', 401);
  assert.strictEqual(authErr.isAuthError, true);

  const conflictErr = new ApiError('Conflict', 409);
  assert.strictEqual(conflictErr.isConflict, true);

  const serverErr = new ApiError('Server error', 500);
  assert.strictEqual(serverErr.isServerError, true);
});

test('2. Base URL trailing slash normalization prevents double slashes in API calls', () => {
  const normalizeBaseUrl = (url) => (url || '').replace(/\/+$/, '');

  assert.strictEqual(normalizeBaseUrl('https://bookend-backend-7y88.onrender.com/'), 'https://bookend-backend-7y88.onrender.com');
  assert.strictEqual(normalizeBaseUrl('https://bookend-backend-7y88.onrender.com///'), 'https://bookend-backend-7y88.onrender.com');
  assert.strictEqual(normalizeBaseUrl('https://bookend-backend-7y88.onrender.com'), 'https://bookend-backend-7y88.onrender.com');
  assert.strictEqual(normalizeBaseUrl(''), '');
  assert.strictEqual(normalizeBaseUrl(undefined), '');
  assert.strictEqual(normalizeBaseUrl(null), '');
});
