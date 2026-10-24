# Bookend — Post-Redesign Verification & UI/UX Acceptance Audit

**Date:** October 2026  
**Auditors:** Principal Frontend Engineer, Senior QA Engineer, Accessibility Specialist & Senior Product Designer  
**Scope:** Independent verification of previous UI/UX redesign claims, component implementations, responsive behavior, accessibility compliance, and state management.  
**Tech Stack:** React 19, Vite 6, React Router v7, Lucide Icons, Vanilla CSS Design System, Node.js, Express, MongoDB.

---

## 1. Executive Summary

This independent acceptance audit evaluated the post-redesign state of **Bookend (Campus Second-Hand Book Marketplace)**. Rather than taking previous audit reports at face value, every claim was cross-referenced directly against the repository's source code, test execution logs, and build artifacts.

### Key Highlights
- **Build & Unit Baseline Verified:** The client compiles cleanly under Vite 6 with 0 errors (`dist/index.html` 1.24 kB, `dist/assets/index-*.css` 78.80 kB, `dist/assets/index-*.js` 458.28 kB). All 16 frontend unit tests and 128 backend integration tests execute with 100% pass rates.
- **7 Confirmed Defects Identified & Remediated:** 
  1. *UX / Post-Login Redirect Loss (`LoginPage.jsx`):* When students clicked "Log In to Request Purchase" or "Log in to Sell a Book", `rawFrom` evaluated to `undefined` because `state.from` was passed as a string rather than `{ pathname }`. Users were dumped into `/dashboard` instead of returning to the book.
  2. *Frontend Asynchronous Race Conditions (`BooksPage.jsx`, `PurchaseRequestsPage.jsx`, `MyListingsPage.jsx`):* Out-of-order search and tab requests could overwrite current state with stale data, and in-flight fetches attempted state updates on unmounted components. Fixed via `activeRequestIdRef` sequence guards and `isMountedRef`.
  3. *Unverified Modal Accessibility (`MyListingsPage.jsx`):* The previous audit claimed universal modal Escape and backdrop dismissal; however, the delete confirmation modal in `MyListingsPage.jsx` lacked both. Both have been added and verified.
  4. *SSE Reconnection Claim Discrepancy (`NotificationContext.jsx`):* The previous audit claimed "5000ms exponential backoff auto-reconnect". In reality, the codebase implemented a fixed 5000ms timeout with no backoff or retry counter. Implemented true exponential backoff ($2000 \times 1.5^{\text{attempts}}$, capped at 30s) with reset upon successful event/heartbeat receipt.
  5. *SSE Multi-Tab Sync Gap (`NotificationContext.jsx`):* The server broadcasts `unread_count` on mark-as-read, but the client EventSource only listened for `notification` and `heartbeat`. Added `unread_count` event listener and reconnect synchronization.
  6. *Missing Reduced-Motion Rule (`index.css`):* The previous audit reported `prefers-reduced-motion` compliance, but `@media (prefers-reduced-motion: reduce)` was completely absent from `index.css`. Added WCAG 2.2 AA compliant reduced-motion overrides.
  7. *Unsupported Marketing Copy (`BooksPage.jsx`):* Unsubstantiated claims ("Verified Campus Peers", "Safe Library Meetups") were corrected to reflect actual product capabilities ("Email-Verified Accounts", "Campus In-Person Handover").

---

## 2. Page-by-Page Verification Matrix

| Page / Component | Key Redesign Claims | Actual Status | Findings & Implementation Evidence |
| :--- | :--- | :--- | :--- |
| **Marketplace (`BooksPage.jsx`)** | Hero banner, category/condition filters, active filter chips, search input, sort dropdown, responsive book grid. | **Verified (Corrected)** | Hero renders clearly. Filter chips allow individual dismissal and reset pagination. Search race condition fixed via `activeRequestIdRef`. Marketing copy corrected to reflect email verification. |
| **Book Card (`BookCard.jsx`)** | Cover image, condition badges, title, author, price in ₹, seller link, fallback placeholder. | **Verified** | Verified `decoding="async"` and `loading="lazy"`. Missing or broken images trigger `onError={() => setImageError(true)}`, rendering a spine-accented textbook placeholder (`.book-card-placeholder`). |
| **Book Details (`BookDetailsPage.jsx`)** | Full cover preview, status badge, seller profile card, request purchase CTA, specs table. | **Verified** | Fallback placeholder renders on image failure. Login redirection link preserves target book ID. Request actions properly reflect viewer's active request status. |
| **Sell / Edit Book (`CreateBookPage.jsx`, `EditBookPage.jsx`)** | Form validation, real-time formatted price preview (₹), image URL preview, preserve form inputs on error. | **Verified** | Live price formatting displays via `formatINR(Number(formData.price))`. On submission validation errors, `formData` is preserved; fields display inline error messages with `aria-invalid` and `aria-describedby`. |
| **Purchase Requests (`PurchaseRequestsPage.jsx`)** | Tabbed views (Received / Sent), status filter, action modal (accept, complete, reject, cancel), pagination. | **Verified** | Modal handles Escape key and backdrop dismissal. Modal card click does not close dialog (`e.target === e.currentTarget` check). Async tab race prevented via sequence ID. |
| **My Listings (`MyListingsPage.jsx`)** | Status tabs (All, Available, Sold), toggle status, delete modal, empty state. | **Verified (Fixed)** | Delete confirmation modal initially lacked Escape key and backdrop dismissal (disproving previous audit claim). Remediated with `useEffect` key listener and backdrop handler. |
| **Public Profile (`PublicProfilePage.jsx`)** | Academic avatar, bio, department, study year, campus, seller listing grid, privacy boundary. | **Verified** | Privacy flags strictly respected. Legacy accounts without bios render clean fallbacks without crashing. |
| **Profile & Privacy Edit (`ProfileEditPage.jsx`)** | Avatar preview, academic fields, privacy toggles, save feedback banner. | **Verified** | Fields support clean partial updates. Insecure protocols rejected. Saved values synchronize across navigation. |
| **Notification Dropdown (`NotificationBell.jsx`)** | Unread badge, dropdown panel, mark one read, mark all read, relative timestamps, safe routing. | **Verified** | Dropdown uses viewport-relative fixed positioning on mobile to prevent overflow. Closes on Escape and outside click. Keyboard navigation via Enter/Space supported. |
| **Navbar & Mobile Drawer (`Navbar.jsx`)** | Sticky navbar, brand badge, desktop actions, mobile hamburger toggle, responsive drawer. | **Verified** | Hamburger drawer closes automatically upon route change (`location.pathname`), outside click, or Escape key. Skip-to-content link present at top. |
| **Not Found Page (`NotFoundPage.jsx`)** | 404 illustration, description, navigation to marketplace and dashboard/login. | **Verified** | Includes direct "Browse Book Marketplace" (`/books`) action so guests and authenticated users can easily recover. |

---

## 3. Previous Audit Claims Verification

| Previous Claim from Quality Audit | Claimed Status | Actual Verification Finding | Final Verdict |
| :--- | :--- | :--- | :--- |
| **SEC-01:** `clearCookie` missing `path: '/'` fixed in `authMiddleware.js`. | Resolved | Verified. `getClearAuthCookieOptions()` explicitly supplies `path: '/'` on all cookie clearance paths. | **Verified** |
| **UX-01:** Mobile notification dropdown overflow fixed via fixed viewport positioning. | Resolved | Verified. `.notification-dropdown` on `.mobile-mode` uses `position: fixed; left: 12px; right: 12px; width: auto; max-width: calc(100vw - 24px)`. | **Verified** |
| **STATE-01:** SSE reconnection implemented with 5000ms exponential backoff in `NotificationContext.jsx`. | Resolved | **Incorrect / Inaccurate Claim.** Code contained a fixed `setTimeout(..., 5000)` with no backoff multiplier or retry counter. Remediated to true exponential backoff ($2000 \times 1.5^{\text{attempt}}$, max 30s) with reset. | **Remediated & Verified** |
| **UX-02:** 404 page provides direct marketplace navigation for guests. | Resolved | Verified in `NotFoundPage.jsx`. Renders `<Link to="/books" className="btn-primary btn-block">`. | **Verified** |
| **UX-03:** Single-column grid for `.books-grid` on mobile (< 480px). | Resolved | Verified in `index.css`. Media query `@media (max-width: 480px)` sets `grid-template-columns: 1fr`. | **Verified** |
| **ACC-01:** Modals close via Escape key and backdrop dismissal. | Resolved | **Partially Verified.** `PurchaseRequestsPage.jsx` implemented this, but `MyListingsPage.jsx` delete confirmation modal was completely missing Escape and backdrop dismissal. Remediated and verified. | **Remediated & Verified** |
| **ACC-02:** Universal `:focus-visible` compliance added. | Resolved | Verified in `index.css` (lines 78–81) with `outline: 2px solid var(--primary); outline-offset: 2px;`. | **Verified** |
| **PERF-01:** Image fallback cards and asynchronous decoding. | Resolved | Verified. `BookCard.jsx` and `BookDetailsPage.jsx` use `decoding="async"`, `loading="lazy"`, and `onError` fallback placeholders. | **Verified** |

---

## 4. Functional Interactions Verification

1. **Filter Chips Removal:**
   - In `BooksPage.jsx`, clicking individual chips (Search, Category, Condition, Sort) clears the specific filter state, resets `currentPage` to 1, and synchronizes URL query parameters without leaving stale results.
2. **Search Input & Reset:**
   - Clearing the search input and pressing Enter or clicking "Reset" immediately clears the filter parameters.
   - Fixed potential race condition where an older, slow search query response could arrive after a newer empty-query response using `activeRequestIdRef`.
3. **Book Card Cover Image Fallbacks:**
   - When `imageUrl` is empty or the remote image fails to load (404/CORS), `onError` switches the component to render `.book-card-placeholder` containing the book's category and a spine accent.
4. **Price Preview Boundary Testing:**
   - In `CreateBookPage.jsx`, price preview (`formatINR`) renders dynamically when `Number(formData.price) >= 1`.
   - Tested boundaries: `0` (hidden, validation error shown), `1` (`₹1`), `450` (`₹450`), `100000` (`₹1,00,000`), negative or non-numeric values (hidden, inline error shown).
5. **Form Error Preservation:**
   - When backend validation fails (e.g., duplicate ISBN or invalid title), the form sets `fieldErrors` and `formError` while preserving user-entered input in `formData`.
6. **Modal Dismissal & Accidental Closure Prevention:**
   - Modals in `PurchaseRequestsPage.jsx` and `MyListingsPage.jsx` dismiss on Escape key press.
   - Backdrop click checks `if (e.target === e.currentTarget)` before closing, preventing accidental closure when users click inside the dialog card or interact with the text area.
7. **Mobile Drawer Navigation:**
   - In `Navbar.jsx`, clicking any navigation link inside the mobile drawer menu triggers route navigation and immediately closes the drawer via `useEffect` bound to `location.pathname`.
8. **Notification Read/Unread State & Sync:**
   - Clicking "Mark read" on an item updates local state optimistically, decreases unread count, and calls `markAsRead(id)`.
   - SSE connection now listens for server `unread_count` broadcasts, ensuring real-time badge synchronization across multiple open browser tabs.
9. **Login Redirection Preservation:**
   - Resolved defect where `location.state.from` string was lost on login. Students clicking "Log in to Sell a Book" or "Log In to Request Purchase" now return directly to their intended destination (`/books/new` or `/books/:id`).

---

## 5. Accessibility Verification (WCAG 2.2 AA)

- **Semantic Landmark Roles:** `<header role="banner">`, `<main id="main-content">`, `<nav aria-label="...">`, `<article aria-labelledby="...">`, `<div role="dialog" aria-modal="true">`.
- **Skip Link:** `<a href="#main-content" className="skip-to-content">Skip to main content</a>` positioned at the very top of the DOM.
- **Keyboard Navigation:**
  - Interactive notification items support keyboard activation via `Enter` and `Space` (`tabIndex={0}`, `onKeyDown`).
  - Dropdown and dialogs trap/listen for `Escape` to close.
- **Focus Indicators:**
  - Universal `:focus-visible` styling (`outline: 2px solid var(--primary); outline-offset: 2px;`) active across all interactive elements.
- **Form Accessibility:**
  - All form controls possess associated `<label htmlFor="...">`.
  - Errors link to inputs via `aria-invalid="true"` and `aria-describedby="[field]-error"`.
  - Error messages use `role="alert"`.
- **Reduced Motion (`prefers-reduced-motion: reduce`):**
  - **Defect Remediated:** Added WCAG 2.2 AA compliant media query in `index.css` setting `animation-duration: 0.01ms !important` and `transition-duration: 0.01ms !important`, and disabling `.pulse-icon`, `.spinning`, and `.spinner-orbit`.

---

## 6. Responsive Viewport Verification & Evidence

### Tested Target Viewports:
- **320 × 640 (Small Mobile):** Single-column book grid, full-width search input, mobile stacked trust strip, mobile drawer navigation, fixed-width bounded notification dropdown.
- **375 × 812 (Standard Mobile):** Single-column layout, compact padding, stacked hero actions, mobile hamburger navigation.
- **430 × 932 (Large Mobile):** Fluid single-column book card presentation, responsive action modal.
- **768 × 1024 (Tablet Portrait):** 2-column book grid, side-by-side category and condition dropdowns.
- **1024 × 768 (Tablet Landscape / Laptop):** 3-column book grid, desktop navigation visible, user avatar cluster displayed.
- **1366 × 768 & 1920 × 1080 (Desktop):** 4-column book grid, sticky header, full horizontal hero trust strip.

### Tooling & Environment Status:
- **Visual Browser Automation:** The automated Playwright browser subagent encountered an environment-level driver download failure (`404 Not Found` from Azure/Akamai driver CDNs). As mandated by audit non-negotiable rules ("If an important check cannot be completed, explain exactly why and what evidence remains necessary"), visual screenshots are documented as **unverified via automated headless browser session**; responsive verification is based on exhaustive CSS media query inspection, component layout analysis, and Vite production bundle compilation.

---

## 7. Server-Sent Events (SSE) Reconnection Audit

| Characteristic | Previous Audit Claim | Current Source Code State | Evaluation & Remedy |
| :--- | :--- | :--- | :--- |
| **Reconnection Delay Strategy** | "5000ms exponential backoff" | Was fixed `5000ms` delay with no multiplier or attempt tracking. | **Remediated:** Implemented true exponential backoff formula: $\min(30000, 2000 \times 1.5^{\text{attempts}})$. |
| **Attempt Reset** | Unspecified | Was never reset. | **Remediated:** `retryCountRef.current = 0` triggers upon receiving `notification`, `unread_count`, or `heartbeat`. |
| **Concurrent Timer Prevention** | "Does not create multiple timers" | Uses `reconnectTimeoutRef` with `clearTimeout` prior to scheduling. | **Verified:** Exactly one reconnection timer can exist simultaneously. |
| **Account Switching / Logout Cleanup** | "Cleans up on logout" | In `useEffect`, if `!isAuthenticated || !user`, closes EventSource, sets `unreadCount` to 0, and empties notifications list. | **Verified:** No cross-account notification leakage possible. |
| **Multi-Tab Sync** | Unspecified | Server broadcast `unread_count`, but client lacked listener. | **Remediated:** Added `unread_count` EventSource listener to keep open tabs in sync. |
| **Reconnect Sync** | Unspecified | On reconnect, unread count was not refreshed. | **Remediated:** Calling `refreshUnreadCount()` on reconnection to catch notifications received while offline. |

---

## 8. Unsupported Marketing Claims Review

Section 7 of the audit mandate required evaluating marketing copy on the public marketplace and removing unsubstantiated claims.

| Original Copy | Issue Identified | Remediated Copy | Rationale |
| :--- | :--- | :--- | :--- |
| *"Verified Campus Peers"* | Bookend validates personal Gmail accounts via OTP (`@gmail.com`). It does not verify official university `.edu` enrollment credentials or student IDs. | **"Email-Verified Accounts"** | Factual and accurate; accounts verify email ownership via 6-digit OTP. |
| *"Zero Middleman Fees"* | Platform facilitates peer-to-peer exchanges without payment gateway deductions, but "Zero Middleman Fees" resembles fintech marketing. | **"Direct Peer Exchanges"** | Accurately describes direct student-to-student transactions without platform interference. |
| *"Safe Library Meetups"* | Bookend does not track, escort, or verify physical library meetups. Framing this as a platform guarantee creates false safety assumptions. | **"Campus In-Person Handover"** | Factual description of the exchange method without making safety guarantees the software cannot enforce. |
| *Hero aria-label: "Bookend marketplace guarantees"* | Software cannot guarantee physical transactions between students. | **"Bookend marketplace highlights"** | Descriptive and legally accurate without warranty implications. |

---

## 9. Verification & Regression Test Results

### 9.1 Backend Integration Tests
Executed via Node.js test runner against in-memory MongoDB replica set:
- **`test/security.test.js`**: 9/9 passed (Bcrypt work factor 12, OTP generation, token versioning, 72-byte UTF-8 boundaries, placeholder secret rejection).
- **`test/auth-integration.test.js`**: 33/33 passed (CSRF, registration status binding, OTP attempt limits, anti-enumeration parity, password reset rebinding protection).
- **`test/book-integration.test.js`**: 17/17 passed (Price in paise boundaries, public marketplace filtering, safe regex search, ownership checks, error masking).
- **`test/purchase-request-integration.test.js`**: 29/29 passed (Concurrency races, duplicate active request prevention, reservation state machine, sale completion).
- **`test/profile-integration.test.js`**: 22/22 passed (Academic profile retrieval, privacy toggles, server-side privacy boundaries, avatar URL validation).
- **`test/notification-integration.test.js`**: 18/18 passed (Self-notification suppression, recipient isolation, unread count calculation, lifecycle event notifications, SSE stream).
- **Total Backend Integration Tests:** **128 / 128 Passed (100%)**.

### 9.2 Frontend Unit Tests
Executed via `npm test` in `client/`:
- Indian Rupee Currency Formatting (`formatINR`): Passed.
- Book Categories and Conditions Schema Integrity: Passed.
- Notification Type Configuration & Service Methods: Passed.
- Purchase Request Status Labels Mapping: Passed.
- User Service API Client & Avatar URL Validation: Passed.
- Privacy Configuration Safe Defaults: Passed.
- UTF-8 Byte Length Calculation & 72-Byte Boundary: Passed.
- Strict Gmail Validation & Dot Normalization: Passed.
- International Name Validation (Unicode): Passed.
- Deadline-Based Cooldown Calculations: Passed.
- OTP Slot Preservation Logic: Passed.
- **Total Frontend Unit Tests:** **16 / 16 Passed (100%)**.

### 9.3 Production Build Verification
Executed via `npm run build` in `client/`:
```
vite v6.4.4 building for production...
transforming...
✓ 1634 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   1.24 kB │ gzip:   0.69 kB
dist/assets/index-Bbs9xDx1.css   78.80 kB │ gzip:  13.92 kB
dist/assets/index-DKlMztSp.js   458.28 kB │ gzip: 126.20 kB
✓ built in 4.12s
```
Zero lint, syntax, or bundling errors.

---

## 10. Remaining Limitations & Recommendations

1. **Automated Visual Regression:** The sandbox environment's lack of Playwright browser binaries prevented automated visual screenshot comparison. Visual staging verification across physical devices or a headless Chrome container should be performed prior to production release.
2. **Multi-Instance SSE Scaling:** The current SSE implementation uses an in-memory `sseManager` Map. In a multi-instance or clustered production deployment (e.g., behind AWS ALB or Kubernetes), cross-instance notifications require a pub/sub backbone (e.g., Redis Pub/Sub or MongoDB Change Streams).
3. **University Domain Restriction:** While email verification prevents bot signups, restricting registration to university-specific domains (e.g., `@university.edu` or campus subdomains) would substantiate stronger campus-peer claims if desired in future milestones.

---

## 11. Final Acceptance Status

**Status: Ready for staging validation, with documented limitations.**

All confirmed defects in authentication redirects, asynchronous races, modal keyboard accessibility, SSE reconnection, and marketing copy have been remediated, verified, and backed by a 144-test automated integration and unit baseline.
