# Bookend Architecture Specification

## 1. System Overview

Bookend is a full-stack, peer-to-peer campus textbook marketplace designed for university students. The architecture prioritizes data integrity, strict access control, peer privacy, and resilient real-time communication.

```
┌─────────────────────────────────────────────────────────────┐
│                      Client (React 19)                      │
│  - Vite + React Router 7 (Code-Split Routes)                │
│  - URL SearchParams as Single Source of Truth               │
│  - NotificationContext + SSE EventSource                    │
│  - Obsidian Monochrome Design Token System                  │
└──────────────┬──────────────────────────────▲───────────────┘
               │ HTTP Requests (Fetch API)    │ SSE Stream
               │ Credentials (HttpOnly Cookie)│
               ▼                              │
┌─────────────────────────────────────────────┴───────────────┐
│                    Server (Node.js/Express)                 │
│  - Helmet + Origin Whitelist + Custom CSRF Defense          │
│  - JWT Cookie Session + `tokenVersion` Revocation           │
│  - Controllers & Services -> Atomic Conditional Queries     │
│  - In-Memory SSE Connection Pool & Real-Time Dispatcher     │
└──────────────┬──────────────────────────────────────────────┘
               │ Mongoose 8.x
               ▼
┌─────────────────────────────────────────────────────────────┐
│                 MongoDB Atlas Database                      │
│  - Collections: users, books, purchaserequests,            │
│    notifications, otpverifications                          │
│  - Partial Unique Indexes for Single Active Reservation     │
│  - Integer Paise Currency Boundaries                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Component Boundaries & Responsibilities

### 2.1 Frontend Client (`client/`)
- **Technology:** React 19, Vite 6, React Router 7, Lucide Icons, Framer Motion.
- **Runtime:** Static single-page application served via Alpine Nginx (`nginx:1.27-alpine`) with dynamic `$PORT` substitution and SPA routing fallback (`try_files $uri $uri/ /index.html`).
- **State Architecture:**
  - Marketplace search and filter state is bound directly to the browser URL search parameters (`search`, `category`, `condition`, `sortBy`, `page`).
  - Active book folio details modal mounts cleanly over the marketplace without breaking URL deep-linking or page state (`/books/:id`).
  - Authentication state is tracked via `AuthContext` with an initial `/api/auth/me` verification handshake.
  - Notifications are tracked via `NotificationContext` with optimistic updates, rollback snapshot capability, and resilient Server-Sent Events (SSE) listening.

### 2.2 Backend API (`server/`)
- **Technology:** Node.js 20 LTS, Express 4.21, Mongoose 8.12.
- **Runtime:** Minimal multi-stage Docker container (`node:20-alpine`) executed as unprivileged `USER node` with direct PID 1 execution (`node src/server.js`) for graceful `SIGTERM`/`SIGINT` draining.
- **Service Layers:**
  - `middleware/`: Security headers (Helmet), CORS origin validation, custom header-based CSRF protection, cookie extraction, and JWT verification.
  - `controllers/`: HTTP boundary validation, request sanitization, response formatting, and status code assignment.
  - `services/`: Business logic, transactional mutations, external email dispatch via Resend HTTPS API, and notification event emission.
  - `models/`: Mongoose schemas, schema-level validation constraints, virtual field computations, and compound indexes.

### 2.3 Database Layer (MongoDB Atlas)
- **Collections:** `users`, `books`, `purchaserequests`, `notifications`, `otpverifications`.
- **Indexing Strategy:**
  - Compound indexes on `{ status: 1, createdAt: -1 }`, `{ status: 1, category: 1, createdAt: -1 }`, `{ status: 1, category: 1, priceInPaise: 1 }`, `{ status: 1, title: 1 }`, and `{ status: 1, author: 1 }` for scalable marketplace querying.
  - Unique index on `{ email: 1 }` for users.
  - Partial unique index on `{ book: 1 }` with filter `{ status: 'accepted' }` on `purchaserequests` to enforce single-reservation integrity at the database engine level.

---

## 3. Authentication & Session Architecture

1. **Email OTP Registration & Verification:**
   - Registration creates a pending record in `otpverifications` with a bcrypt-hashed 6-digit OTP code and a 10-minute expiry deadline.
   - OTP delivery uses the Resend HTTPS API (`https://api.resend.com/emails`).
   - Rate limiting and cooldowns (60-second cooldown between resend attempts, maximum 5 invalid verification attempts before invalidation) prevent brute-force attacks.
2. **Cookie-Based JWT Sessions:**
   - Successful login issues an `auth_token` stored in an `HttpOnly`, `SameSite=None` (production) / `SameSite=Lax` (development), `Secure` (production) cookie.
   - Credentials are never exposed to JavaScript via `document.cookie`.
3. **Session Revocation via `tokenVersion`:**
   - Every user document contains an integer `tokenVersion` (starting at 0).
   - The signed JWT payload contains `{ id: user._id, tokenVersion: user.tokenVersion }`.
   - On password change or global logout, `tokenVersion` is atomically incremented via `$inc`. All existing tokens across all devices are rendered invalid immediately upon the next request.

---

## 4. Key Business Invariants & Integrity Constraints

| Invariant | Implementation Mechanism | Enforcement Layer |
| :--- | :--- | :--- |
| **Integer Currency** | Stored as `priceInPaise` (1 INR = 100 paise; min 100, max 10,000,000). Avoids IEEE 754 floating point precision errors. | Mongoose Schema + Validator |
| **Single Reservation** | Partial unique index on `{ book: 1 }` where `{ status: 'accepted' }`. Catches E11000 duplicate key error and returns HTTP 409 Conflict. | MongoDB Engine Index |
| **State Machine Transitions** | Status transitions (`available` → `reserved` → `sold`) use atomic conditional queries (`status: 'available'`) with optional transaction fallback. | Controller / Service Layer |
| **Public DTO Sanitization** | `serializePublicBook` and `serializePublicProfile` strip password hashes, emails, `acceptedRequest` references, and private academic fields. | DTO Serializer |
| **Idempotent Notifications** | Compound unique index on `{ recipient: 1, idempotencyKey: 1 }` prevents duplicate notification insertion on concurrent events. | MongoDB Engine Index |
