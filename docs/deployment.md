# Bookend Production Deployment & Operations Guide

This guide covers building, testing, publishing, deploying, verifying, and rolling back Bookend across GitHub Actions, Docker Hub, and Render.

---

## 1. Deployment Architecture

```
Developer Push → GitHub (main/master)
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
Frontend CI/CD Workflow    Backend CI/CD Workflow
(.github/workflows/         (.github/workflows/
 bookend-frontend-cd.yml)    bookend-ci-cd.yml)
         │                       │
         ├── Frontend Tests      ├── Backend Tests (167)
         │   (25 unit tests)     │   (Security & integration)
         └── Production Build    └── PR Dry-Run Validation
         │                       │
         ▼ (Gate Passed)         ▼ (Gate Passed)
Docker Build (Client)       Docker Build (Server)
(Node 20 + Nginx 1.27)      (Node 20 Minimal Runtime)
         │                       │
         ▼                       ▼
Docker Hub Registry         Docker Hub Registry
<user>/bookend-frontend     <user>/bookend-backend
├── :<commit-sha>           ├── :<commit-sha>
└── :latest                 └── :latest
         │                       │
         ▼ (Webhook Dispatch)    ▼ (Webhook Dispatch)
Render Frontend Service     Render Backend Service
(Nginx Web Service)         (Node Web Service)
```

---

## 2. GitHub Actions Secrets & Variables

Configure these values in GitHub repository **Settings → Secrets and variables → Actions**:

### 2.1 Repository Variables (Plain Text)
| Variable Name | Purpose | Example |
| :--- | :--- | :--- |
| `DOCKERHUB_USERNAME` | Docker Hub namespace for container images | `shivamux` |

### 2.2 Repository Secrets (Encrypted)
| Secret Name | Purpose | Where to Obtain |
| :--- | :--- | :--- |
| `DOCKERHUB_TOKEN` | Docker Hub Access Token with read/write permissions | Docker Hub Account Settings → Security → Personal Access Tokens |
| `RENDER_DEPLOY_HOOK` | Webhook URL to trigger Backend deployment on Render | Render Dashboard → Bookend Backend Service → Settings → Deploy Hook |
| `RENDER_FRONTEND_DEPLOY_HOOK` | Webhook URL to trigger Frontend deployment on Render | Render Dashboard → Bookend Frontend Service → Settings → Deploy Hook |

---

## 3. Local Docker Build Verification

### 3.1 Backend Image Build
```bash
# Build backend image
docker build -t bookend-backend ./server

# Test backend container locally
docker run --rm -p 5000:5000 \
  -e PORT=5000 \
  -e NODE_ENV=production \
  -e CLIENT_URL=http://localhost:5173 \
  -e MONGO_URI="mongodb+srv://<user>:<pwd>@<cluster>.mongodb.net/bookend?retryWrites=true&w=majority" \
  -e JWT_SECRET="test_local_jwt_secret_min_32_characters_ok" \
  -e RESEND_API_KEY="re_test_key" \
  bookend-backend
```
- Verify health: `curl http://localhost:5000/api/health`

### 3.2 Frontend Image Build
```bash
# Build frontend image (injecting the intended backend URL)
docker build \
  --build-arg VITE_API_BASE_URL=https://bookend-backend-7y88.onrender.com \
  -t bookend-frontend ./client

# Test frontend container locally
docker run --rm -p 8080:80 -e PORT=80 bookend-frontend
```
- Verify health: `curl http://localhost:8080/healthz`
- Verify SPA route: `curl -I http://localhost:8080/books` (HTTP 200)

---

## 4. Render Service Configuration

### 4.1 Backend Web Service
1. **Environment:** Docker
2. **Health Check Path:** `/api/health`
3. **Environment Variables on Render:**
   - `NODE_ENV`: `production`
   - `PORT`: (Leave unset; Render dynamically assigns and injects `$PORT`)
   - `CLIENT_URL`: `https://bookend.onrender.com` (or custom frontend domain)
   - `COOKIE_SAME_SITE`: `none`
   - `COOKIE_SECURE`: `true`
   - `MONGO_URI`: Atlas connection string
   - `JWT_SECRET`: 64+ character random secret
   - `RESEND_API_KEY`: Production Resend API key
   - `EMAIL_FROM`: `Campus Book Exchange <onboarding@resend.dev>` (or custom verified domain)

### 4.2 Frontend Web Service
1. **Environment:** Docker
2. **Health Check Path:** `/healthz`
3. **Environment Variables on Render:**
   - None required at runtime; API base URL is baked during Docker build stage via `ARG VITE_API_BASE_URL`.

### 4.3 Production Database Index Migration
Because Mongoose automatic index building is disabled in production (`autoIndex: false`), you must run the safe, idempotent index migration script against the production database whenever schema indexes change:
```bash
# Execute dry-run invariant check first (safe, non-destructive audit)
MONGO_URI="<production-atlas-uri>" node src/scripts/migrateIndexes.js --dry-run

# Run authoritative index migration and verification
MONGO_URI="<production-atlas-uri>" npm run migrate:indexes
```
The migration script performs pre-flight data audits (checking for duplicate emails, multiple accepted requests, active buyer collisions), removes obsolete indexes safely, builds required unique indexes, and verifies the actual index definitions in MongoDB.

---

## 5. Post-Deployment Verification & Smoke Tests

> [!IMPORTANT]
> **Distinguishing Webhook Initiation from Live Container Health:**
> Render deploy hooks return HTTP 200 upon receiving the webhook request. This acknowledges that the deployment was queued; it does NOT confirm that the container image was pulled, booted, or passed health checks. Always execute the verification commands below to confirm active service availability.

Execute these commands immediately after a production deployment completes:

1. **Backend Health Check:**
   ```bash
   curl -s -i https://bookend-backend-7y88.onrender.com/api/health
   # Expected status: 200 OK
   # Response includes: {"status":"healthy","service":"Campus Book Exchange Auth API"}
   ```

2. **Frontend Health & Security Headers:**
   ```bash
   curl -s -i https://bookend.onrender.com/healthz
   # Expected status: 200 OK
   # Response: healthy

   curl -s -I https://bookend.onrender.com/
   # Verify security headers:
   # X-Frame-Options: DENY
   # X-Content-Type-Options: nosniff
   # Server: nginx (version hidden)
   ```

3. **Core Journey Smoke Test:**
   - Load `/books` in browser and confirm textbook listings populate.
   - Perform test login and check that `auth_token` cookie is stored with `Secure` and `SameSite=None` attributes.
   - Confirm SSE live connection connects to `/api/notifications/stream`.

---

## 6. Rollback Procedures

### Method 1: Instant Rollback via Render Dashboard (Recommended)
1. Go to the Render Dashboard and click the affected service.
2. Navigate to the **Deploys** tab.
3. Locate the last known good deployment commit.
4. Click `...` next to the deployment and select **Rollback to this deploy**.

### Method 2: Manual Deploy Hook Trigger
Deploy a specific historical commit SHA:
```bash
PREV_SHA="<last-known-healthy-commit-sha>"
ENCODED_IMAGE=$(node -e "console.log(encodeURIComponent('docker.io/<username>/bookend-backend:' + process.argv[1]))" "$PREV_SHA")
curl -X POST "${RENDER_DEPLOY_HOOK}&imgURL=${ENCODED_IMAGE}"
```

### Method 3: Git Revert
Revert the bad commit on `main`:
```bash
git revert <problematic-commit-sha>
git push origin main
```
The automated CI/CD pipeline will test, build, and deploy the reverted state cleanly.
