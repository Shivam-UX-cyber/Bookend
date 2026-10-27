# Changelog

All notable changes to the Bookend campus textbook marketplace are documented in this file.

---

## [2.2.0] - 2026-10-27

### Database & Index Migration
- **Production Index Migration Runner:** Implemented idempotent migration script (`server/src/scripts/migrateIndexes.js`) with pre-flight invariant audits for duplicate emails, multiple accepted requests, active buyer collisions, and idempotency keys before enforcing unique constraints.
- **Search Query Index Optimization:** Removed obsolete `book_text_search` text index from `Book.js` (unused by regex search queries), eliminating write overhead and RAM consumption, and added compound index `{ status: 1, category: 1, createdAt: -1 }` for optimized category browsing.

### Transaction Integrity & Recovery
- **Deterministic Capability Probing:** Replaced brittle substring matching (`err.message.includes('replica set')`) in `transactionHelper.js` with authoritative connection probing via MongoDB `hello` command. Prevented transient replica set errors from subverting transaction safety.
- **Guarded Conditional Rollback:** Implemented explicit, conditional compensation blocks in `purchaseRequestController.js` (`respondToRequest`, `cancelRequest`, `completeSale`) and `bookController.js` (`updateBookStatus`, `deleteBook`) for standalone MongoDB mode, restoring records only under strict matching conditions without overwriting concurrent writes.

### Security & Server Lifecycle
- **Bounded Graceful Shutdown:** Implemented multi-stage shutdown in `server.js` with active SSE stream termination (`sseManager.closeAll()`), in-flight request draining, clean MongoDB disconnection, and a 10-second forced exit fallback timer.
- **CSRF Custom-Header Enforcement:** Updated `csrfMiddleware.js` to strictly enforce `X-Requested-With: XMLHttpRequest` (or `X-CSRF-Protection`) on all state-changing methods in production and testing, aligned with `docs/security.md` and frontend `api.js`.

### Frontend & Documentation
- **Allowed-Value Enum Validation:** Updated client `validateBookForm` in `validation.js` to validate category and condition against `BOOK_CATEGORIES` and `BOOK_CONDITIONS` enums.
- **Repository-Relative Links:** Replaced 15 machine-specific `file:///d:/...` paths in `docs/testing.md` with repository-relative links.
- **Canonical Documentation Footprint:** Consolidated the repository to exactly 7 active Markdown documents (`README.md`, `CHANGELOG.md`, and 5 guides under `docs/`). Removed historical audit snapshots.
- **Automated Regression Test Suite:** Added 16 new automated integration tests covering index migration, transaction recovery, graceful shutdown, and CSRF header verification (192 total tests: 167 backend + 25 frontend, 100% passing).

---

## [2.1.0] - 2026-10-27

### Backend & Data Integrity
- **Database Partial Unique Index:** Added partial unique index `{ book: 1 }` where `{ status: 'accepted' }` on `PurchaseRequest`, enforcing a single active reservation per book at the database engine level and returning HTTP 409 Conflict on collisions.
- **Transactional Consistency:** Wrapped book status changes to `sold` and listing deletions in `runWithOptionalTransaction` with automatic standalone rollback compensation and transient commit retry loops.
- **Search Query Indexing:** Added compound indexes on `{ status: 1, title: 1 }`, `{ status: 1, author: 1 }`, and text index on `{ title: 'text', author: 'text' }`.
- **Resend HTTPS Email Delivery:** Replaced legacy SMTP transporter with the official Resend Node.js SDK (`https://api.resend.com/emails`), resolving outbound TCP `ETIMEDOUT` connection issues on Render Free instances.
- **Canonical Cookie Configuration:** Unified cookie option generation in `server/src/utils/cookieHelper.js` shared between authentication controllers and middleware.
- **Protected Remote Diagnostic Endpoint:** Added authenticated diagnostic endpoint (`/api/auth/diagnostic-smtp`) with dedicated `DIAGNOSTIC_KEY` authorization, strict rate limiting, host whitelisting, and credential redaction.
- **Pruned Dead Dependencies:** Removed unused `nodemailer` package from `server/package.json`.

### Frontend & Accessibility
- **Route-Level Code Splitting:** Converted static page imports in `App.jsx` to `React.lazy()` with `<Suspense>` fallback, drastically reducing initial page load times.
- **Manual Vendor Chunking:** Configured Rollup manual chunks in `vite.config.js` (`vendor-react`, `vendor-icons`, `vendor-motion`). Reduced initial bundle from 617 kB to 248 kB (gzip 76 kB) and eliminated Vite chunk size warnings.
- **Bug Fix in Marketplace Search:** Fixed `ReferenceError: setSearchQuery is not defined` when clicking category suggestion buttons on empty search results in `BooksPage.jsx`.
- **WCAG 2.1 AA Focus Trap:** Created `useFocusTrap` hook with Tab and Shift+Tab cycling and focus restoration on unmount, integrated into `BookDetailsModal.jsx`.
- **Motion Accessibility:** Added `prefers-reduced-motion` detection in `SmokeBackground.jsx` to halt 60fps canvas particle simulations for users with reduced-motion preferences.
- **Shared Validation Utility:** Extracted `validateBookForm` into `utils/validation.js` matching backend Mongoose schema constraints, reused across `CreateBookPage.jsx` and `EditBookPage.jsx`.
- **Media Fallback:** Added graceful `onError` fallback handling for book cover images and student profile avatars across `BookCard.jsx`, `BookDetailsModal.jsx`, and `PublicProfilePage.jsx`.

### DevOps & Infrastructure
- **Graceful Container Shutdown:** Updated `server/Dockerfile` to `CMD ["node", "src/server.js"]` (direct PID 1 execution), allowing Node.js to receive `SIGTERM`/`SIGINT` signals and close active connections cleanly.
- **Nginx Security Hardening:** Configured `server_tokens off;` and `X-Content-Type-Options: nosniff` on static assets in `client/nginx.conf.template`.
- **CI/CD Concurrency Controls:** Added top-level concurrency groups to both GitHub Actions workflows, preventing out-of-order or duplicate deployments from rapid consecutive commits.
- **Service Isolation & Path Filtering:** Scoped `bookend-ci-cd.yml` with path filtering to `server/**` and decoupled backend builds from frontend code changes.
- **Manual Dispatch Fix:** Fixed `workflow_dispatch` evaluation in `bookend-ci-cd.yml` so manual triggers on `main`/`master` execute release jobs.
- **Documentation Consolidation:** Consolidated repository documentation into canonical guides (`architecture.md`, `development.md`, `security.md`, `deployment.md`, `testing.md`) and archived historical audits into `docs/archive/`.
