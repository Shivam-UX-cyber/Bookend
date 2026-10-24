# Bookend — Comprehensive Full-Stack Architecture, Security & Quality Audit

**Date:** October 2026  
**Auditor:** Principal Full-Stack Engineer, Application Security Engineer & System Architect  
**Project:** Bookend — Campus Second-Hand Book Marketplace  
**Tech Stack:** React 19, Vite 6, Node.js, Express, MongoDB (Mongoose), HTTP-only Cookies, Server-Sent Events (SSE)  

---

## 1. Executive Summary & Architecture Mapping

Bookend is a full-stack campus second-hand book exchange platform tailored for university students. The application facilitates student-to-student book discovery, listing management, purchase requests, reservations, sale completion, and real-time in-app notifications.

### 1.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                       React 19 + Vite Frontend              │
│  - AuthContext (Session tracking & active user state)       │
│  - NotificationContext (SSE stream & reactive unread badge) │
│  - React Router v7 (Protected & public routes)              │
│  - Custom Design System (Oceanic Glassmorphism & Tokens)    │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / Credentials: include
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Node.js + Express Backend                │
│  - Helmet (Security headers) & CORS (Allowlisted origins)   │
│  - CookieParser & CSRF Protection (Origin / Custom header)  │
│  - Rate Limiters (Auth: 20/15m, OTP: 10/15m, General: 200)  │
│  - AuthMiddleware (Token versioning & revocation)           │
│  - NotificationService (In-memory SSE manager + heartbeat)  │
│  - TransactionHelper (Replica-set / Standalone fallback)    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     MongoDB / Mongoose                      │
│  - User (tokenVersion, academic profile, privacy flags)     │
│  - Book (priceInPaise, status, acceptedRequest)             │
│  - PurchaseRequest (unique partial active request index)    │
│  - Notification (sparse unique idempotency key index)       │
│  - PendingRegistration & PasswordReset (flow token sessions)│
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Baseline Verification
- **Backend Integration Tests:** 128/128 passing across Security (9), Auth (33), Books (17), Purchase Requests (29), Profiles (22), and Notifications (18).
- **Frontend Unit Tests:** 16/16 passing across currency formatting, schema integrity, validation, and service contracts.
- **Production Bundle:** Vite build compiles with 0 errors in 4.07 seconds.

---

## 2. Confirmed Findings Register

| ID | Priority | Category | Affected File(s) | Description & Impact | Fix & Remediation | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | **P1 (High)** | Security / Session Management | `server/src/middleware/authMiddleware.js` (lines 22, 37, 50) | `res.clearCookie('authToken')` lacks explicit `path: '/'`. When clearing on nested routes, sub-path matching fails to clear the root-pathed cookie, leaving stale tokens in browser. | Centralized `getClearAuthCookieOptions()` with explicit `path: '/'` on all `clearCookie` invocations. | **Resolved & Verified** |
| **UX-01** | **P2 (Med)** | Responsiveness / Mobile Overflow | `client/src/index.css` (lines 4780-4795) | `.notification-dropdown` on mobile (`.mobile-mode`) uses fixed pixel offsets (`right: -55px; width: 320px`), causing severe horizontal overflow and clipping on 320px–375px viewports. | Updated mobile dropdown to viewport-relative fixed positioning (`position: fixed; left: 12px; right: 12px; width: auto;`). | **Resolved & Verified** |
| **STATE-01** | **P2 (Med)** | Reliability / SSE Lifecycle | `client/src/context/NotificationContext.jsx` (line 120) | When `es.readyState === EventSource.CLOSED`, the SSE listener cleans up but does not schedule an automated backoff reconnection, leaving users without live updates if the server restarts. | Implemented 5000ms exponential backoff auto-reconnect timer in `NotificationContext.jsx`. | **Resolved & Verified** |
| **UX-02** | **P2 (Med)** | Navigation / 404 Recovery | `client/src/pages/NotFoundPage.jsx` | Unauthenticated users landing on 404 only see "Back to Login", missing the primary public action "Browse Marketplace" (`/books`). | Added prominent "Browse Book Marketplace" action to 404 page for both authenticated and guest visitors. | **Resolved & Verified** |
| **UX-03** | **P2 (Med)** | Design System / Layout | `client/src/index.css` (`.books-grid`) | `.books-grid` uses `minmax(280px, 1fr)`, which on narrow 320px screens with container padding causes horizontal compression and clipping. | Added `@media (max-width: 480px) { .books-grid { grid-template-columns: 1fr; } }` and mobile filter stacking. | **Resolved & Verified** |
| **ACC-01** | **P2 (Med)** | Accessibility / WCAG | `client/src/index.css`, `BookDetailsPage.jsx`, `PurchaseRequestsPage.jsx` | Focus rings on interactive elements lack universal WCAG 2.2 AA compliance; modals lack Escape-key and backdrop dismissal. | Added universal `:focus-visible` outline rules and Escape-key event listeners with backdrop dismissals. | **Resolved & Verified** |
| **PERF-01** | **P3 (Low)** | Performance / Image Loading | `client/src/components/BookCard.jsx`, `BookDetailsPage.jsx` | External cover images lack asynchronous decoding and failover skeleton transitions during initial render. | Added `decoding="async"`, `loading="lazy"`, and spine-accented textbook fallback cards. | **Resolved & Verified** |

---

## 3. Detailed Security Assessment

### 3.1 Authentication & Session Integrity
- **Password Storage:** Uses `bcryptjs` with work factor 12. Password inputs are strictly bounded at 72 bytes (preventing bcrypt truncation attacks) and require uppercase, lowercase, number, and special character combinations.
- **Session Tokens:** Stateless JWTs stored in `HttpOnly`, `SameSite=Lax` (or `Strict` in production) cookies with path `/`. Tokens carry `tokenVersion`, enabling global session revocation on password changes.
- **CSRF Protection:** Custom `csrfProtection` middleware enforces Origin/Referer header verification against allowlisted frontend domains and requires custom `X-Requested-With` header on state-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`).
- **Account Enumeration Defense:** Password reset and registration status flows maintain strict response parity for non-existent vs existing email accounts.

### 3.2 Authorization & Access Control (BOLA/IDOR Prevention)
- **Book Ownership:** `PATCH /api/books/:id` and `DELETE /api/books/:id` verify `book.seller.toString() === req.user._id.toString()`. Cross-user mutations return `403 Forbidden`.
- **Purchase Requests:** Only the buyer or seller associated with a request can view details or transition states.
- **Notifications:** Every read and unread query filters by `recipient: req.user._id`. Cross-user marking attempts return `403 Forbidden`.

### 3.3 Rate Limiting & DoS Protection
- `authLimiter`: 20 requests / 15 minutes per IP on `/login` and `/register`.
- `otpLimiter`: 10 requests / 15 minutes per IP on verification endpoints.
- `generalLimiter`: 200 requests / 15 minutes per IP across all `/api` routes.
- Request payload body size capped at `10kb`.

---

## 4. Business Logic, Concurrency & Data Integrity

### 4.1 Purchase Request State Machine
- **States:** `pending` ➔ `accepted` (reserved) ➔ `completed` (sold).
- **Cancellations:** Permitted from `pending` (buyer only) or `accepted` (buyer or seller).
- **Concurrency Protections:**
  1. Partial unique index `{ book: 1, buyer: 1 }` for active statuses prevents duplicate requests from the same student.
  2. Conditional atomic updates (`findOneAndUpdate({ _id: bookId, status: 'available', acceptedRequest: null })`) ensure that if two buyers request a book, only one can be accepted.
  3. Sale completion atomically updates the book status to `sold` and transitions competing pending requests to `rejected` with clean reason tags.
  4. Deleting an available listing automatically notifies pending buyers and rejects orphan requests.

### 4.2 Non-Corrupting Notification Delivery
- Notification dispatching is decoupled via `notifySafely`. If notification writing or SSE streaming fails, it is trapped and logged, ensuring core purchase lifecycle records are never corrupted or rolled back due to secondary notification failures.

---

## 5. UI/UX, Design System & Accessibility Review

### 5.1 Design Tokens & Aesthetic Consistency
- Palette: **Deep Oceanic Glassmorphism** (`--bg-deep: #070b14`, `--bg-surface: #0f172a`, `--bg-card: rgba(15, 23, 42, 0.78)`).
- Typography: Outfit (headings) and Plus Jakarta Sans (body).
- Card layouts, buttons, forms, and badges adhere to structured elevation and border-radius tokens (`--radius-md: 10px`, `--radius-lg: 16px`, `--radius-xl: 24px`).

### 5.2 Responsive Viewport Verification Targets
- **320 × 640 (Small Mobile):** Requires full single-column grid for books, full-width search input, and viewport-bounded notification dropdown.
- **375 × 812 & 430 × 932 (Mobile):** Responsive drawer navigation, compact padding, stacked hero actions.
- **768 × 1024 (Tablet):** 2-column book grid, side-by-side filters.
- **1024 × 768 to 1920 × 1080 (Desktop):** Up to 4-column book grid, sticky navbar with user profile cluster and notification bell.

---

## 6. Phased Remediation Plan

1. **Phase 2 (Critical Security & Correctness):**
   - Fix `clearCookie` missing `path: '/'` in `authMiddleware.js`.
   - Add regression tests verifying cookie clearance on nested sub-paths.
2. **Phase 3 (Frontend Reliability & State Management):**
   - Add SSE exponential backoff auto-reconnect in `NotificationContext.jsx`.
   - Update `NotFoundPage.jsx` with direct navigation to Marketplace (`/books`).
3. **Phase 4 & 5 (Design System, UI/UX & Responsive Overhaul):**
   - Fix mobile notification dropdown position (`position: fixed; left: 12px; right: 12px`).
   - Polish responsive grids for 320px–480px viewports across Books, My Listings, Purchase Requests, and Book Details.
   - Improve focus-visible rings for keyboard accessibility.
4. **Phase 6 & 7 (Animation & Final Verification):**
   - Verify `prefers-reduced-motion` compliance.
   - Run complete backend test suite (128+ tests) and frontend tests (16+ tests).
   - Verify Vite production build.
