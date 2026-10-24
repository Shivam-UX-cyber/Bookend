# Bookend — Campus Second-Hand Book Marketplace

Bookend is a full-stack, peer-to-peer campus textbook marketplace designed for university students. Students can discover course textbooks, list books for sale, submit purchase requests with in-person handover coordination, manage listings, view student profiles, and receive real-time notifications via Server-Sent Events.

---

## Architecture Overview

- **Frontend:** React 19, Vite, React Router 7, Vanilla CSS design token system (Vercel deployment).
- **Backend:** Node.js 20 LTS, Express 4, Mongoose 8, Helmet, CORS, CSRF defense, Cookie session authentication with JWT and `tokenVersion` revocation (Render Docker container deployment).
- **Database:** MongoDB Atlas with atomic conditional updates, concurrency race protection, and integer paise currency boundaries.
- **CI/CD Pipeline:** GitHub Actions automated test suites (148 tests across frontend and backend), multi-stage Docker image build, Docker Hub registry publication, and automated Render deployment.

---

## Repository Structure

```
├── .github/
│   └── workflows/
│       └── bookend-ci-cd.yml      # GitHub Actions CI/CD Pipeline
├── client/                        # React 19 + Vite frontend
│   ├── src/                       # Components, pages, context, styles
│   ├── test/                      # Frontend unit test suites
│   ├── .env.example               # Frontend environment template
│   └── package.json
├── server/                        # Express 4 + Node.js backend
│   ├── src/                       # Controllers, models, routes, services
│   ├── test/                      # Security & integration test suites
│   ├── Dockerfile                 # Multi-stage production container build
│   ├── .dockerignore              # Docker build context exclusions
│   ├── .env.example               # Backend environment template
│   └── package.json
└── docs/                          # Engineering & operational documentation
    ├── deployment-guide.md        # Comprehensive deployment and operations guide
    ├── bookend-engineering-audit.md
    ├── bookend-fix-report.md
    ├── bookend-test-report.md
    ├── bookend-architecture.md
    └── bookend-production-readiness.md
```

---

## Local Development Quickstart

### 1. Backend Setup
```bash
cd server
cp .env.example .env
npm install
npm run dev
```
Backend runs at `http://localhost:5000` (Healthcheck: `http://localhost:5000/api/health`).

### 2. Frontend Setup
```bash
cd client
cp .env.example .env
npm install
npm run dev
```
Frontend runs at `http://localhost:5173`.

---

## Automated Test Suites

### Run All Backend Tests (128 Tests across 6 Suites)
```bash
cd server
npm test
```
Tests cover:
- Injection defense, NoSQL prevention, Unicode names, and bcrypt 72-byte limits (`test/security.test.js`)
- Authentication, session revocation, OTP cooldowns, and anti-enumeration (`test/auth-integration.test.js`)
- Book listing lifecycle, integer paise pricing, and public DTO sanitization (`test/book-integration.test.js`)
- Purchase request concurrency races, double-click deduplication, and atomic rollbacks (`test/purchase-request-integration.test.js`)
- Student profile serialization and privacy preferences (`test/profile-integration.test.js`)
- Notification system, unread count deduplication, and isolated SSE streams (`test/notification-integration.test.js`)

### Run All Frontend Tests (20 Tests)
```bash
cd client
npm test
```

### Production Build
```bash
cd client
npm run build
```

---

## Production Deployment & CI/CD

For complete step-by-step instructions on setting up GitHub Actions secrets, Docker Hub repositories, Render web services, and Vercel frontend deployments, refer to:

👉 **[Production Deployment & Operations Guide](docs/deployment-guide.md)**
