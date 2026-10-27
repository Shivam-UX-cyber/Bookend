# Bookend Automated Testing & Verification Guide

This document catalogs Bookend's automated test suites, execution commands, verification evidence, and testing boundaries.

---

## 1. Test Execution Commands

### 1.1 Backend Test Suite
```bash
cd server
npm test
```
Executes all 10 integration test suites sequentially using Node's test runner and ephemeral in-memory MongoDB instances (`mongodb-memory-server`).

### 1.2 Frontend Test Suite
```bash
cd client
npm test
```
Executes all 7 frontend unit test suites using Node's native test runner (`node --test test/*.test.js`).

### 1.3 Database Index Migration & Verification
```bash
cd server
npm run migrate:indexes
```
Audits database data invariants (duplicate emails, multiple accepted requests, active buyer collisions, idempotency keys), drops obsolete indexes safely, builds required unique indexes, and verifies index definitions.

### 1.4 Frontend Production Compilation
```bash
cd client
npm run build
```
Compiles and minifies the React 19 application using Vite with manual vendor chunking and route code-splitting.

---

## 2. Test Suite Catalog & Breakdown

### 2.1 Backend Integration Tests (167 Tests across 10 Suites)

| Test File | Tests Run | Pass | Scope / Invariants Verified |
| :--- | :---: | :---: | :--- |
| [`server/test/security.test.js`](../server/test/security.test.js) | 24 | 24 | NoSQL injection, prototype pollution, XSS sanitization, mass assignment defense, regex escaping, ReDoS prevention, bcrypt 72-byte limit, Unicode name validation. |
| [`server/test/auth-integration.test.js`](../server/test/auth-integration.test.js) | 18 | 18 | Registration, OTP generation and expiry, 60s cooldown boundaries, password reset, token version revocation, logout revocation. |
| [`server/test/book-integration.test.js`](../server/test/book-integration.test.js) | 21 | 21 | Listing creation, integer paise storage, public DTO (`serializePublicBook`), status transitions (`available` → `sold`), standalone rollback compensation. |
| [`server/test/purchase-request-integration.test.js`](../server/test/purchase-request-integration.test.js) | 30 | 30 | Concurrency races (two buyers, double-click, cancel vs accept, cancel vs reject), atomic rollback compensation, partial unique index single-reservation enforcement. |
| [`server/test/profile-integration.test.js`](../server/test/profile-integration.test.js) | 22 | 22 | Private profile fields, privacy toggles, public DTO sanitization, cross-user authorization, avatar URL validation. |
| [`server/test/notification-integration.test.js`](../server/test/notification-integration.test.js) | 18 | 18 | Recipient isolation, unread count shape normalization, SSE stream delivery, event deduplication, graceful process exit. |
| [`server/test/proxy-and-otp-fix.test.js`](../server/test/proxy-and-otp-fix.test.js) | 18 | 18 | Reverse proxy IP trust, Resend HTTPS email delivery, zero-cooldown retry on delivery failure, remote diagnostic endpoint security & secret redaction. |
| [`server/test/index-migration.test.js`](../server/test/index-migration.test.js) | 6 | 6 | Invariant pre-flight audits (duplicate emails, multiple accepted requests, buyer collisions), clean index creation, obsolete text index drop, idempotency. |
| [`server/test/transaction-integrity.test.js`](../server/test/transaction-integrity.test.js) | 4 | 4 | Reliable topology capability detection, replica set error isolation without fallback, mid-write acceptance and sale completion rollback compensation. |
| [`server/test/shutdown-and-csrf.test.js`](../server/test/shutdown-and-csrf.test.js) | 6 | 6 | Bounded graceful shutdown with active SSE draining, resilient multi-step cleanup, CSRF untrusted origin/referer blocking, custom header enforcement, safe GET. |
| **Total Backend** | **167** | **167** | **100% Passing** |

### 2.2 Frontend Unit Tests (25 Tests across 7 Files)

| Test File | Tests Run | Pass | Scope / Invariants Verified |
| :--- | :---: | :---: | :--- |
| [`client/test/api-client.test.js`](../client/test/api-client.test.js) | 2 | 2 | `ApiError` distinguishes true network failures from aborts and timeouts; trailing slash base URL normalization. |
| [`client/test/book-service.test.js`](../client/test/book-service.test.js) | 2 | 2 | Indian Rupee formatting (`formatINR`); schema category and condition integrity. |
| [`client/test/focus-trap.test.js`](../client/test/focus-trap.test.js) | 3 | 3 | `FOCUSABLE_SELECTOR` boundary, Tab/Shift+Tab cycling simulation, focus restoration on modal unmount. |
| [`client/test/notification-service.test.js`](../client/test/notification-service.test.js) | 5 | 5 | Lifecycle event config, API method definitions, dual response shape parsing, SSE duplicate event handling without count inflation. |
| [`client/test/purchase-request-service.test.js`](../client/test/purchase-request-service.test.js) | 2 | 2 | Status label mappings; service API methods. |
| [`client/test/user-service.test.js`](../client/test/user-service.test.js) | 4 | 4 | API client methods, avatar URL validation, privacy safe defaults, display name fallback. |
| [`client/test/validation.test.js`](../client/test/validation.test.js) | 7 | 7 | UTF-8 byte length calculation without Buffer, password criteria evaluation, Gmail dot rules, Unicode name validation, cooldown calculations, OTP slot preservation, shared `validateBookForm` boundaries with schema enum verification. |
| **Total Frontend** | **25** | **25** | **100% Passing** |

---

## 3. Verification Evidence

- **Total Automated Tests:** 192 tests (167 Backend + 25 Frontend).
- **Test Pass Rate:** 100% (0 failures, 0 skipped).
- **Vite Production Build:** Built in 4.5 seconds with zero warnings.
- **Bundle Optimization:** Main bundle reduced from 617 kB to 248 kB (gzip 76 kB) through route-level code splitting and manual vendor chunks (`vendor-react`, `vendor-icons`, `vendor-motion`).

---

## 4. Testing Boundaries & Manual Verification

1. **End-to-End Browser Automation:** Real browser user journeys are tested manually due to local sandbox container limitations with Playwright drivers.
2. **Screen Reader Compatibility:** Automated tests verify ARIA landmark roles and labels. Manual verification with NVDA on Windows and VoiceOver on macOS is recommended for staging deployments.
3. **Third-Party Email Delivery:** Automated tests verify Resend API contract and mocked responses. Live delivery requires a verified domain in Resend for recipient addresses other than the account owner.
