# Bookend Remediation & Fix Report

**Date:** October 16, 2026  
**Auditor:** Principal Software Engineer, Senior Full-Stack Engineer, Application Security Engineer  
**Status:** All Remediations Implemented & Verified  

---

## 1. Overview of Remediations

This document details all code changes across the Bookend codebase to address the 27 defects identified in the master engineering audit. Every modification follows the non-negotiable principles of state preservation, backward compatibility, zero destructive schema changes, honest verification claims, and defensive error handling.

---

## 2. Server-Side Remediations

### 2.1 Notification Controller & Service (`server/src/controllers/notificationController.js`, `server/src/services/notificationService.js`)
- **Files Affected:**
  - `server/src/controllers/notificationController.js`
  - `server/src/services/notificationService.js`
- **Remediation Details:**
  1. **Dual Canonical Contract (Bug 1):** Updated `getUnreadNotificationCount`, `markNotificationRead`, and `markAllNotificationsRead` to return `{ success: true, data: { unreadCount }, unreadCount }`. This guarantees compatibility regardless of whether client consumers read top-level or data-nested counts.
  2. **SSE Event Loop & Heartbeat (Bug 5):**
     - Added `.unref()` to the notification service heartbeat interval so that background timers do not artificially keep the Node.js event loop active when all client requests complete.
     - Formatted SSE heartbeat comments into valid event streams (`event: heartbeat\ndata: {}\n\n`) according to the W3C Server-Sent Events standard.
     - Added `closeAllConnections()` for graceful server shutdown and teardown in automated integration testing.
  3. **Pagination & Ordering (Bug 14):**
     - Capped `safePage` to `Math.min(1000, Math.max(1, page))` and `safeLimit` to `Math.min(50, Math.max(1, limit))`.
     - Appended deterministic `_id: -1` tie-breaker to `.sort({ createdAt: -1, _id: -1 })` to eliminate pagination drift.

### 2.2 Book Controller & Public DTO (`server/src/controllers/bookController.js`)
- **Files Affected:**
  - `server/src/controllers/bookController.js`
- **Remediation Details:**
  1. **Public DTO Serialization (Bug 11):**
     - Created `serializePublicBook(bookDoc)` helper that strictly allowlists safe public book attributes: `_id`, `id`, `title`, `author`, `description`, `category`, `condition`, `price`, `priceInPaise`, `imageUrl`, `isbn`, `seller` (with `_id`, `name`, `displayName`, `avatarUrl`), `status`, `createdAt`, `updatedAt`.
     - Explicitly stripped internal references including `acceptedRequest` to prevent leaking the winner's purchase request ID to unauthenticated visitors.
  2. **Bounded Pagination & Stable Sorting (Bug 14):**
     - In `getBooks` and `getMyBooks`, capped `page` at `Math.min(1000, Math.max(1, ...))`.
     - Appended `_id: -1` (or `_id: 1` for oldest) as deterministic tie-breakers on all sorting queries.
  3. **Manual Status Transition Invariant (Bug 6):**
     - Enforced in `updateBookStatus` that sellers can only transition between `'available'` and `'sold'`. Manual transition to `'reserved'` is blocked with 400 Bad Request, ensuring reservations are governed exclusively by the purchase-request lifecycle.

### 2.3 Purchase Request Controller & Consistency (`server/src/controllers/purchaseRequestController.js`)
- **Files Affected:**
  - `server/src/controllers/purchaseRequestController.js`
- **Remediation Details:**
  1. **Concurrency Protection (Bugs 7, 8, 9, 10):**
     - Atomic conditional queries (`findOneAndUpdate({ _id, status: 'available', acceptedRequest: null })`) ensure two concurrent buyers cannot both reserve the same book, and double-click actions return 409 Conflict rather than creating duplicate state.
     - Rollback compensation ensures standalone MongoDB deployments maintain relational consistency without leaving orphaned reservations.
  2. **Pagination & Stable Sorting (Bug 14):**
     - In `getSentRequests` and `getReceivedRequests`, capped `page` at `Math.min(1000, ...)`.
     - Appended `_id: -1` tie-breaker on `.sort({ createdAt: -1, _id: -1 })`.

### 2.4 User Controller (`server/src/controllers/userController.js`)
- **Files Affected:**
  - `server/src/controllers/userController.js`
- **Remediation Details:**
  1. **Profile Privacy & Public DTO (Bug 13):**
     - Enforced server-side evaluation of user privacy preferences (`privacy.showBio`, `privacy.showDepartment`, `privacy.showYear`). Sensitive credentials (email, password, token version) are strictly excluded from public responses.
  2. **Pagination & Sorting (Bug 14):**
     - In `getPublicProfile`, capped `page` at `Math.min(1000, ...)` and appended `_id: -1` tie-breaker on listings sorting.

---

## 3. Client-Side Remediations

### 3.1 API Client Wrapper (`client/src/services/api.js`)
- **Files Affected:**
  - `client/src/services/api.js`
- **Remediation Details:**
  1. **Error Classification (Bug 19):**
     - Rewrote `ApiError` to strictly differentiate true network failures (`status === 0 && !isAborted && !isTimeout`) from intentional aborts (`isAborted: true`) and timeouts (`isTimeout: true`).
     - Intentional request cancellation no longer triggers network outage alert toasts.
  2. **Configurable Request Timeouts (Bug 20):**
     - Introduced default 15-second request timeout using linked `AbortController`. Mutations and long-running queries timeout cleanly without hanging UI spinners indefinitely.

### 3.2 Notification Context (`client/src/context/NotificationContext.jsx`)
- **Files Affected:**
  - `client/src/context/NotificationContext.jsx`
- **Remediation Details:**
  1. **Canonical Unread Count Parsing (Bug 1):**
     - Normalizes incoming counts using `res?.data?.unreadCount ?? res?.unreadCount ?? 0`.
  2. **SSE Duplicate Event Deduplication (Bug 2):**
     - Relocated unread badge increments strictly inside `setNotifications`. Count only increments if the notification is genuinely new (`!exists`) and unread (`!newNotif.isRead`).
  3. **Optimistic Rollback (Bug 3):**
     - Preserves previous state snapshots in `markAsRead` and `markAllAsRead`. Reverts both the notifications list and unread count if the server mutation fails.
  4. **Session Generation Tracking (Bug 4):**
     - Tracks `sessionGenerationRef` to discard asynchronous responses from in-flight requests initiated prior to logout or user switching.
  5. **Exponential Backoff Reconnect (Bug 5):**
     - Implements bounded exponential backoff with jitter for SSE reconnection.

### 3.3 Marketplace Search & URL State (`client/src/pages/BooksPage.jsx`)
- **Files Affected:**
  - `client/src/pages/BooksPage.jsx`
- **Remediation Details:**
  1. **Single Source of Truth (Bugs 17, 18):**
     - URL `searchParams` acts as the authoritative source of truth for `search`, `category`, `condition`, `sortBy`, and `page`.
  2. **Debounced Search Input (Bug 17):**
     - Typing updates local `searchInput` state and debounces URL updates by 350ms, eliminating redundant keystroke API queries.
     - Search form submission updates URL immediately and cancels pending debounce timers without duplicate fetching.
  3. **History Synchronization (Bug 18):**
     - Browser Back and Forward navigation automatically triggers React Router parameter updates, synchronizing marketplace filters and search input smoothly.
  4. **Modal Navigation Context (Bug 18):**
     - Closing the book details modal preserves the active query string (`navigate({ pathname: '/books', search: location.search }, { replace: true })`).

### 3.4 Factual Verification Claims (`Bug 12`)
- **Files Affected:**
  - `client/src/pages/PublicProfilePage.jsx`
  - `client/src/pages/ProfileEditPage.jsx`
  - `client/src/pages/DashboardPage.jsx`
  - `client/src/components/Navbar.jsx`
  - `client/src/components/BookDetailsModal.jsx`
  - `client/src/components/BookCard.jsx`
- **Remediation Details:**
  - Replaced unsubstantiated "Verified Peer" / "Verified Student" badges with accurate, transparent terminology: "Email-Verified Peer" and "Email-Verified Student".

### 3.5 Design System Tokens & Style Cleanup (`Bugs 23, 24`)
- **Files Affected:**
  - `client/src/styles/variables.css`
  - `client/src/styles/profile.css`
- **Remediation Details:**
  - Added alias tokens `--text-primary: var(--text-main);`, `--surface: var(--bg-surface);`, and `--border: var(--border-subtle);` in `variables.css`.
  - Replaced all ad-hoc `--text-primary` references in `profile.css` with canonical `--text-main`.
  - Verified zero undefined CSS variables across the client build.
