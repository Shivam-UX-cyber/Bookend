# Bookend Local Development Guide

This guide covers prerequisites, environment configuration, installation, local execution, automated test execution, and troubleshooting for Bookend.

---

## 1. Prerequisites

- **Node.js:** v20.x LTS or higher
- **npm:** v10.x or higher
- **Database:** Local MongoDB instance (`mongodb://localhost:27017/bookend`) or MongoDB Atlas cluster connection string
- **Git:** v2.30+
- **Docker Desktop (Optional):** Required only if testing local container builds

---

## 2. Environment Configuration

Bookend uses separate environment files for the frontend and backend. Both contain `.env.example` templates in their respective directories.

### 2.1 Backend Environment (`server/.env`)

Copy the template:
```bash
cd server
cp .env.example .env
```

| Variable | Description | Requirement | Example (Dev) |
| :--- | :--- | :--- | :--- |
| `PORT` | Local HTTP listening port | Optional (Default: `5000`) | `5000` |
| `NODE_ENV` | Runtime environment mode | Required | `development` |
| `CLIENT_URL` | Allowed frontend URL for CORS & Cookie headers | Required | `http://localhost:5173` |
| `MONGO_URI` | MongoDB connection string | Required | `mongodb://localhost:27017/bookend` |
| `JWT_SECRET` | Secret key for signing session tokens | Required (min 32 chars) | `dev_ephemeral_jwt_secret_min_32_chars_ok` |
| `JWT_EXPIRES_IN` | Token duration | Optional (Default: `7d`) | `7d` |
| `COOKIE_SAME_SITE` | Cookie SameSite attribute | Required (`lax` for dev, `none` for prod) | `lax` |
| `COOKIE_SECURE` | Cookie Secure flag | Required (`false` for dev http, `true` for prod) | `false` |
| `RESEND_API_KEY` | Resend HTTPS Email API key | Optional for offline tests; Required for live emails | `re_your_test_key` |
| `EMAIL_FROM` | Sender display name and email address | Required | `Campus Book Exchange <onboarding@resend.dev>` |
| `DIAGNOSTIC_KEY` | Secret for protected remote diagnostic endpoint | Optional | `test_diagnostic_key_min_32_characters_long` |

> [!IMPORTANT]
> The backend `.env` contains confidential credentials (`JWT_SECRET`, `MONGO_URI`, `RESEND_API_KEY`). It must **never** be committed to Git. It is excluded by root and package `.gitignore`.

### 2.2 Frontend Environment (`client/.env`)

Copy the template:
```bash
cd client
cp .env.example .env
```

| Variable | Description | Requirement | Example (Dev) |
| :--- | :--- | :--- | :--- |
| `VITE_API_BASE_URL` | Base URL of the backend API service | Required | `http://localhost:5000` |

> [!NOTE]
> `VITE_API_BASE_URL` is a **public build-time variable**. Vite inlines `VITE_*` variables directly into static JavaScript bundles during `npm run build`. Never place secrets in frontend `.env` files.

---

## 3. Installation & Local Execution

### 3.1 Start the Backend Service
```bash
cd server
npm install
npm run dev
```
- Server starts at: `http://localhost:5000`
- Healthcheck endpoint: `http://localhost:5000/api/health`

### 3.2 Start the Frontend Client
In a separate terminal:
```bash
cd client
npm install
npm run dev
```
- Vite dev server starts at: `http://localhost:5173`
- Open your browser to `http://localhost:5173`

---

## 4. Running Automated Tests

All tests run locally using Node's native test runner (`node --test`) without external test runner dependencies.

### Run Backend Tests (167 Tests across 10 Suites)
```bash
cd server
npm test
```
The test suite utilizes `mongodb-memory-server` to spin up isolated in-memory MongoDB instances, requiring no live external database connection.

### Run Frontend Tests (25 Tests across 7 Suites)
```bash
cd client
npm test
```

### Run Frontend Production Bundle Build
```bash
cd client
npm run build
```

---

## 5. Troubleshooting & Common Issues

### Issue 1: CORS Error in Browser Console (`CORS blocked: Origin not allowed`)
- **Cause:** `CLIENT_URL` in `server/.env` does not match the exact origin in your browser (e.g. `http://localhost:5173` vs `http://127.0.0.1:5173`).
- **Fix:** Update `CLIENT_URL=http://localhost:5173` in `server/.env` and restart the backend.

### Issue 2: Cookies Not Saved in Browser During Local Development
- **Cause:** `COOKIE_SECURE` is set to `true` on an insecure HTTP localhost connection, or `COOKIE_SAME_SITE` is set to `none` without HTTPS.
- **Fix:** In `server/.env`, verify `COOKIE_SECURE=false` and `COOKIE_SAME_SITE=lax` for local development.

### Issue 3: Port 5000 or 5173 Already in Use (`EADDRINUSE`)
- **Cause:** A previous Node or Vite process did not release the listening port.
- **Fix (Windows PowerShell):**
  ```powershell
  Get-Process -Id (Get-NetTCPConnection -LocalPort 5000).OwningProcess | Stop-Process -Force
  ```
