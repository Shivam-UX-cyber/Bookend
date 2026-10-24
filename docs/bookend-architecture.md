# Bookend System Architecture & Data Flows

**Date:** October 16, 2026  
**Auditor:** Principal Software Engineer, Database Engineer, Frontend Architect  
**Scope:** Architecture, Data Schemas, Lifecycle State Machines, Security Boundaries  

---

## 1. System Overview

Bookend is a full-stack, peer-to-peer campus second-hand book marketplace designed specifically for university students. The architecture is engineered around the following core principles:

- **Strict Relational & State Integrity:** Every book listing and purchase request transitions through a deterministic state machine with concurrency protection.
- **Privacy by Design:** Public Data Transfer Objects (DTOs) strictly filter internal database references, user emails, passwords, and private academic details.
- **Resilient Real-Time Updates:** Server-Sent Events (SSE) provide live notifications to authenticated users with per-recipient stream isolation and graceful recovery.
- **Client-Side Determinism:** Marketplace discovery state is anchored to the browser URL as the single source of truth, enabling bookmarkable search and functional browser history.

```
┌─────────────────────────────────────────────────────────────┐
│                      Client (React 18)                      │
│  - Vite + React Router DOM                                   │
│  - URL SearchParams as Single Source of Truth               │
│  - NotificationContext + SSE EventSource                   │
│  - Vanilla CSS Token Design System                          │
└──────────────┬──────────────────────────────▲───────────────┘
               │ HTTP Requests (Fetch API)    │ SSE Stream
               │ Credentials (HttpOnly Cookie)│
               ▼                              │
┌─────────────────────────────────────────────┴───────────────┐
│                    Server (Node.js/Express)                 │
│  - JWT + Token Version Invalidation                         │
│  - Strict Origin & CSRF Defense                             │
│  - Controllers -> Services -> Atomic Conditional Queries    │
│  - Notification Dispatcher & SSE Connection Pool            │
└──────────────┬──────────────────────────────────────────────┘
               │ Mongoose 8.x
               ▼
┌─────────────────────────────────────────────────────────────┐
│                     MongoDB Database                        │
│  - Collections: Users, Books, PurchaseRequests, Notifications│
│  - Integer Paise Currency Boundaries                        │
│  - Deterministic Compound Indexes                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Core Data Models & Relationships

### 2.1 User (`server/src/models/User.js`)
- **Primary Key:** `_id` (ObjectId)
- **Identity:** `name` (String, 2-70 chars), `email` (String, lowercased, unique index).
- **Authentication:** `password` (bcrypt hash, min 8 chars / 72 bytes max), `tokenVersion` (Integer, for global session revocation).
- **Verification:** `isVerified` (Boolean, email OTP verified).
- **Public Profile Data:** `displayName` (optional alias), `bio` (max 500 chars), `department` (max 100 chars), `yearOfStudy` (enum: 1-5, PhD, Other), `avatarUrl` (HTTPS only).
- **Privacy Flags:** `privacy.showBio`, `privacy.showDepartment`, `privacy.showYear` (booleans controlling public profile serialization).

### 2.2 Book Listing (`server/src/models/Book.js`)
- **Primary Key:** `_id` (ObjectId)
- **Seller:** `seller` (Ref: User, indexed)
- **Attributes:** `title` (2-150 chars), `author` (2-100 chars), `description` (10-2000 chars), `category` (enum of 12 academic fields), `condition` (enum: New, Like New, Good, Acceptable), `isbn` (optional standard format), `imageUrl` (optional HTTPS image).
- **Price Storage:** `priceInPaise` (Integer, min 100 paise = ₹1.00, max 10000000 paise = ₹1,00,000.00). Exposed as virtual `price` in INR rupees.
- **Status:** Enum: `['available', 'reserved', 'sold']`.
- **Accepted Request Reference:** `acceptedRequest` (Ref: PurchaseRequest, default null). Stripped from all public DTOs.

### 2.3 Purchase Request (`server/src/models/PurchaseRequest.js`)
- **Primary Key:** `_id` (ObjectId)
- **Parties:** `buyer` (Ref: User), `seller` (Ref: User). Both indexed.
- **Listing:** `book` (Ref: Book).
- **Status:** Enum: `['pending', 'accepted', 'rejected', 'cancelled', 'completed']`.
- **Payload:** `message` (Buyer's message, max 500 chars), `rejectionReason` (optional Seller reason, max 500 chars).
- **Timestamps & Handover:** `handoverDetails`, `acceptedAt`, `completedAt`, `cancelledAt`.

### 2.4 Notification (`server/src/models/Notification.js`)
- **Primary Key:** `_id` (ObjectId)
- **Target:** `recipient` (Ref: User, indexed).
- **Actor:** `actor` (Ref: User, optional).
- **Content:** `type` (Enum: 10 lifecycle event types), `title` (String), `message` (String).
- **References:** `relatedBook` (Ref: Book), `relatedPurchaseRequest` (Ref: PurchaseRequest).
- **Read State:** `isRead` (Boolean, default false), `readAt` (Date).
- **Idempotency:** `idempotencyKey` (String, unique compound index on `{ recipient: 1, idempotencyKey: 1 }`).

---

## 3. State Machines & Lifecycle Transitions

### 3.1 Book Listing Lifecycle
```
                 ┌───────────────┐
                 │   available   │
                 └───────┬───────┘
                         │
      ┌──────────────────┴──────────────────┐
      │ (Seller accepts request)            │ (Seller marks sold directly)
      ▼                                     ▼
┌───────────────┐                     ┌───────────────┐
│   reserved    ├────────────────────►│     sold      │
└───────┬───────┘  (Sale completed)   └───────────────┘
        │
        │ (Buyer cancels reservation)
        ▼
┌───────────────┐
│   available   │
└───────────────┘
```
**Invariants:**
1. A listing can only transition to `reserved` when an active purchase request is accepted by the seller.
2. Direct manual transition (`updateBookStatus`) is restricted strictly to `available` <-> `sold`. Manual transition to `reserved` is rejected with 400 Bad Request.
3. Editing a listing's attributes is strictly prohibited while in `reserved` or `sold` status.

### 3.2 Purchase Request Lifecycle
```
                 ┌───────────────┐
                 │    pending    │
                 └───────┬───────┘
                         │
      ┌──────────────────┼──────────────────┐
      │ (Seller accepts) │ (Seller rejects) │ (Buyer cancels)
      ▼                  ▼                  ▼
┌───────────────┐  ┌───────────┐      ┌───────────┐
│   accepted    │  │ rejected  │      │ cancelled │
└───────┬───────┘  └───────────┘      └───────────┘
        │
        ├──────────────────┬──────────────────┐
        │ (Sale completed) │ (Buyer cancels)  │ (Seller cancels)
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────┐      ┌───────────┐
│   completed   │  │ cancelled │      │ cancelled │
└───────────────┘  └───────────┘      └───────────┘
```
**Concurrency & Consistency Invariants:**
1. **Single Accepted Request:** Only one purchase request per book can ever be in `accepted` status at any given time.
2. **Double-Click Deduplication:** Duplicate concurrent request creation by the same buyer returns 409 Conflict without duplicating database records.
3. **Competing Requests:** When a request is accepted, other pending requests remain pending until the sale is completed, at which point all competing pending requests are cleanly transitioned to `rejected` with automated notifications.
4. **Conditional Updates:** All state modifications use preconditions (`status: 'available', acceptedRequest: null`) to prevent race conditions during concurrent execution.

---

## 4. Real-Time Notification Pipeline

```
[Business Action] (e.g. Accept Request)
       │
       ▼
[notifySafely()]
       │
       ├─► Database Write: Notification.create()
       │   └─ Idempotency check prevents duplicate events
       │
       ▼
[sseManager.sendToUser(recipientId, eventData)]
       │
       ├─► Look up active SSE connections for recipientId
       ├─► Transmit payload: "event: notification\ndata: {...}\n\n"
       └─► Isolate stream from all other users
```

- **Heartbeat & Event Loop:** Server transmits named `event: heartbeat\ndata: {}\n\n` frames at 30-second intervals. Timers use `.unref()` to avoid blocking graceful shutdown.
- **Client Handling:** Client `EventSource` receives events, updates state, and deduplicates unread count increments.

---

## 5. Security & Privacy Architecture

1. **Authentication:**
   - JWT tokens stored in `HttpOnly`, `SameSite=Lax`, `Secure` (production) cookies.
   - Global session revocation supported via `tokenVersion` counter on the User model.
2. **Authorization (IDOR/BOLA Protection):**
   - Every mutation explicitly asserts ownership (`book.seller.toString() === req.user._id.toString()`).
   - Notification mutations assert recipient ownership.
3. **Data Exposure (Public DTO Boundaries):**
   - Public books strip `acceptedRequest` and private seller details.
   - Public student profiles strip email, password, token version, and hidden academic fields.
4. **Input Sanitization & Injection Defense:**
   - Strict regex character escaping (`escapeRegex()`) protects search endpoints from ReDoS.
   - Schema validation rejects unknown operators and enforces byte boundaries.
