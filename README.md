# Bookend — Campus Second-Hand Book Marketplace

Bookend is a full-stack, peer-to-peer campus textbook marketplace engineered for university students. Students can discover course textbooks, list books for sale, submit purchase requests with in-person handover coordination, manage active listings, inspect student seller profiles, and receive real-time notifications via Server-Sent Events (SSE).

---

## Architecture Overview

- **Frontend:** React 19, Vite 6 (route-level code splitting), React Router 7, Obsidian Monochrome design system, served via Alpine Nginx with dynamic `$PORT` routing on Render.
- **Backend:** Node.js 20 LTS, Express 4.21, Mongoose 8.12, Helmet security headers, CORS origin whitelist, custom header CSRF defense, and `HttpOnly` cookie session authentication with JWT and `tokenVersion` revocation.
- **Database:** MongoDB Atlas with atomic conditional updates, partial unique indexes for single-reservation integrity, integer paise currency storage, and transactional consistency.
- **Email Delivery:** Resend HTTPS API SDK with automated retries and zero-cooldown delivery failure recovery.
- **CI/CD & Containers:** Independent GitHub Actions pipelines gating releases with 192 automated tests (167 backend + 25 frontend), multi-stage Docker builds, Docker Hub registry publication, and Render deployment webhooks.

---

## Repository Structure

```
├── .github/
│   └── workflows/
│       ├── bookend-ci-cd.yml          # Backend CI/CD Pipeline (Docker Hub + Render)
│       └── bookend-frontend-cd.yml    # Frontend CI/CD Pipeline (Docker Hub + Render)
├── client/                            # React 19 + Vite frontend application
│   ├── src/                           # Components, pages, context, styles
│   ├── test/                          # Frontend unit test suites (25 tests)
│   ├── Dockerfile                     # Multi-stage production container (Node + Nginx)
│   ├── nginx.conf.template            # Dynamic port template & SPA fallback
│   ├── .dockerignore                  # Docker build context exclusions
│   ├── .env.example                   # Frontend environment template
│   └── package.json
├── server/                            # Node.js + Express backend service
│   ├── src/                           # Controllers, models, routes, services, migration scripts
│   ├── test/                          # Security & integration test suites (167 tests)
│   ├── Dockerfile                     # Multi-stage production container (Node 20 runtime)
│   ├── .dockerignore                  # Docker build context exclusions
│   ├── .env.example                   # Backend environment template
│   └── package.json
├── docs/                              # Canonical engineering & operational documentation
│   ├── architecture.md                # System boundaries, data schemas, invariants
│   ├── development.md                 # Prerequisites, local setup, troubleshooting
│   ├── security.md                    # Verified security controls, limits, threat defense
│   ├── deployment.md                  # Docker builds, registry, Render, smoke tests
│   └── testing.md                     # Test execution, suite breakdown, coverage gaps
└── CHANGELOG.md                       # Release notes and version history
```

---

## Local Development Quickstart

### Prerequisites
- Node.js v20.x LTS or higher
- npm v10.x or higher
- MongoDB instance (local or MongoDB Atlas connection string)
- Git

### 1. Start the Backend
```bash
cd server
cp .env.example .env
npm install
npm run dev
```
- API server runs at: `http://localhost:5000`
- Health check endpoint: `http://localhost:5000/api/health`

### 2. Start the Frontend
In a separate terminal:
```bash
cd client
cp .env.example .env
npm install
npm run dev
```
- Frontend runs at: `http://localhost:5173`

---

## Essential Commands

| Task | Backend (`server/`) | Frontend (`client/`) |
| :--- | :--- | :--- |
| **Install Dependencies** | `npm install` | `npm install` |
| **Start Development Server** | `npm run dev` | `npm run dev` |
| **Migrate & Verify Indexes** | `npm run migrate:indexes` | N/A |
| **Execute Test Suites** | `npm test` (167 tests) | `npm test` (25 tests) |
| **Production Build** | N/A (Node runtime) | `npm run build` |
| **Build Docker Container** | `docker build -t bookend-backend ./server` | `docker build -t bookend-frontend ./client` |

---

## Canonical Documentation Guides

For in-depth operational and engineering specifications, consult the dedicated guides:

- 📐 **[System Architecture & Data Flows](docs/architecture.md)**: Component boundaries, data schemas, and lifecycle state machines.
- 💻 **[Local Development & Troubleshooting](docs/development.md)**: Detailed configuration, step-by-step setup, and common fixes.
- 🛡️ **[Security Architecture & Threat Defense](docs/security.md)**: Verified security controls, session invalidation, and rate limiting.
- 🚀 **[Production Deployment & Operations Guide](docs/deployment.md)**: Docker builds, registry tags, Render web services, smoke tests, and rollback.
- 🧪 **[Automated Testing & Verification Guide](docs/testing.md)**: Comprehensive test breakdown (192 tests), assertions, and manual verification items.
- 📜 **[Changelog & Release Notes](CHANGELOG.md)**: Summary of updates, fixes, and architectural improvements.
