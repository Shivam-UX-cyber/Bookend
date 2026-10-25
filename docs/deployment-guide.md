# Bookend — Production Deployment & Operations Guide

This guide provides end-to-end instructions for configuring, building, testing, deploying, operating, and troubleshooting Bookend across GitHub Actions, Docker Hub, and Render.

---

## 1. Repository Structure & Deployment Architecture

```
Developer Push → GitHub (main/master)
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
Frontend CI/CD Workflow    Backend CI/CD Workflow
(.github/workflows/         (.github/workflows/
 bookend-frontend-cd.yml)    bookend-ci-cd.yml)
         │                       │
         ├── Frontend Tests      ├── Backend Tests (128)
         │   (21 unit tests)     │   (Security & integration)
         └── Production Build    └── PR Dry-Run Validation
         │                       │
         ▼ (Pass Gate)           ▼ (Pass Gate)
Docker Image Build          Docker Image Build
(Context: ./client)         (Context: ./server)
Node 20 + Nginx 1.27        Node 20 Runtime
         │                       │
         ▼                       ▼
Docker Hub Registry         Docker Hub Registry
<user>/bookend-frontend     <user>/bookend-backend
├── :<commit-sha>           ├── :<commit-sha>
└── :latest                 └── :latest
         │                       │
         ▼ (Webhook Dispatch)    ▼ (Webhook Dispatch)
Render Web Service          Render Web Service
(Frontend Container)        (Backend API Container)
https://<frontend>.         https://bookend-backend-
onrender.com                7y88.onrender.com
         │                       │
         └────────◄──────────────┘
           HTTPS API Requests (withCredentials)
           Cross-Site Cookies (SameSite=None; Secure)
           CSRF Header: X-Requested-With
           Real-Time SSE: /api/notifications/stream
```

### Component Distribution
- **Frontend Container:** React 19 + Vite compiled bundle served via lightweight Alpine Nginx container on **Render Web Service**.
- **Backend Container:** Node.js 20 + Express 4 + Mongoose container deployed to **Render Web Service** (`https://bookend-backend-7y88.onrender.com`).
- **Database:** MongoDB Atlas cluster with replica set support.
- **Image Registry:** Docker Hub hosting immutable commit-SHA tagged images for both frontend (`<username>/bookend-frontend`) and backend (`<username>/bookend-backend`).
- **CI/CD Pipelines:** Independent GitHub Actions workflows:
  - `.github/workflows/bookend-frontend-cd.yml` (Frontend build, test, Docker image, Render deploy).
  - `.github/workflows/bookend-ci-cd.yml` (Backend test, Docker image, Render deploy).

---

## 2. Local Development Quickstart

### Prerequisites
- Node.js 20.x LTS or higher
- MongoDB instance (local or MongoDB Atlas cluster connection string)
- Docker Desktop (optional, for local container verification)
- Git

### Backend Setup
```bash
cd server
cp .env.example .env
# Edit .env with your local MongoDB URI and secrets
npm install
npm run dev
# Server listens at http://localhost:5000 (Health check: http://localhost:5000/api/health)
```

### Frontend Setup
```bash
cd client
cp .env.example .env
npm install
npm run dev
# Client runs at http://localhost:5173
```

---

## 3. Local Docker Build & Verification

Both the backend and frontend have self-contained multi-stage Dockerfiles.

### 3.1 Backend Docker Container
```bash
# Build backend image
docker build -t bookend-backend ./server

# Run backend container locally
docker run --rm -p 5000:5000 \
  -e PORT=5000 \
  -e NODE_ENV=production \
  -e CLIENT_URL=http://localhost:5173 \
  -e MONGO_URI="mongodb+srv://<user>:<pwd>@<cluster>.mongodb.net/bookend?retryWrites=true&w=majority" \
  -e JWT_SECRET="your_production_secret_at_least_32_characters" \
  bookend-backend

# Test backend health
curl -i http://localhost:5000/api/health
```

### 3.2 Frontend Docker Container
```bash
# Build frontend image (injecting production or local backend API URL)
docker build \
  --build-arg VITE_API_BASE_URL=https://bookend-backend-7y88.onrender.com \
  -t bookend-frontend ./client

# Run frontend container locally (honors dynamic PORT environment variable)
docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  bookend-frontend

# Test frontend health endpoint
curl -i http://localhost:8080/healthz

# Test frontend SPA routing fallback
curl -i http://localhost:8080/books
```

---

## 4. Docker Hub Repositories Setup

1. Log in to [hub.docker.com](https://hub.docker.com).
2. Create two repositories:
   - **`bookend-backend`**: Hosts backend container images.
   - **`bookend-frontend`**: Hosts frontend container images.
   - Set visibility to **Public** (or **Private**; if Private, see Registry Credentials section below).
3. Generate a Personal Access Token:
   - Go to **Account Settings** → **Security** → **Personal Access Tokens**.
   - Click **Generate New Token**.
   - Description: `bookend-github-actions`.
   - Access permissions: **Read & Write**.
   - Copy the generated token immediately.

---

## 5. GitHub Actions Configuration

In your GitHub repository, navigate to **Settings** → **Secrets and variables** → **Actions**.

### Repository Variables (Variables Tab)
| Variable Name | Example Value | Description |
|---|---|---|
| `DOCKERHUB_USERNAME` | `yourdockerhubuser` | Your Docker Hub account username |

### Repository Secrets (Secrets Tab)
| Secret Name | Example Placeholder | Description |
|---|---|---|
| `DOCKERHUB_TOKEN` | `dckr_pat_xxxx...` | Personal Access Token generated in Docker Hub (used by both frontend & backend pipelines) |
| `RENDER_DEPLOY_HOOK` | `https://api.render.com/deploy/srv-backend?key=xxx` | Backend Render Web Service Deploy Hook URL |
| `RENDER_FRONTEND_DEPLOY_HOOK` | `https://api.render.com/deploy/srv-frontend?key=yyy` | Frontend Render Web Service Deploy Hook URL |

---

## 6. Render Web Services Setup

### 6.1 Backend Render Web Service
1. In [render.com](https://render.com), click **New +** → **Web Service**.
2. Select **Deploy an existing image from a registry**.
3. Image URL: `docker.io/<your-dockerhub-username>/bookend-backend:latest`
4. Name: `bookend-backend` (e.g. `bookend-backend-7y88`).
5. Under **Advanced Settings**:
   - Health Check Path: `/api/health`
6. Click **Create Web Service**.
7. In **Settings** → **Deploy Hook**, click **Create Deploy Hook** and copy the URL into GitHub Secrets as `RENDER_DEPLOY_HOOK`.
8. In **Environment**, configure:
   - `NODE_ENV`: `production`
   - `MONGO_URI`: MongoDB connection string
   - `JWT_SECRET`: Random string (min 32 characters)
   - `CLIENT_URL`: URL of your frontend Render service, e.g. `https://bookend-frontend.onrender.com` (no trailing slash)
   - `COOKIE_SAME_SITE`: `none`
   - `COOKIE_SECURE`: `true`
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `EMAIL_USER`, `EMAIL_APP_PASSWORD`

### 6.2 Frontend Render Web Service
1. In [render.com](https://render.com), click **New +** → **Web Service**.
2. Select **Deploy an existing image from a registry**.
3. Image URL: `docker.io/<your-dockerhub-username>/bookend-frontend:latest`
   - *Note:* If your Docker Hub repository is private, click **Add Image Registry Credential** and provide your Docker Hub username and a read-only Docker Hub Personal Access Token.
4. Name: `bookend-frontend` (or your preferred service name).
5. Region: Choose the same region as your backend service (e.g., Oregon / Frankfurt) to minimize latency.
6. Instance Type: **Free** or **Starter**.
7. Under **Advanced Settings**:
   - Health Check Path: `/healthz`
8. Click **Create Web Service**.
9. In **Settings** → **Deploy Hook**, click **Create Deploy Hook** and copy the webhook URL into GitHub Secrets as `RENDER_FRONTEND_DEPLOY_HOOK`.

### 6.3 CORS & Cookie Cross-Origin Alignment
Once your frontend Web Service is created on Render:
1. Copy its public domain (e.g., `https://bookend-frontend-xxxx.onrender.com`).
2. Navigate to your backend service on Render → **Environment**.
3. Update `CLIENT_URL` to match this domain exactly:
   ```
   CLIENT_URL=https://bookend-frontend-xxxx.onrender.com
   ```
   *(Multiple origins can be separated by commas, e.g. `https://bookend-frontend-xxxx.onrender.com,http://localhost:5173`)*
4. Backend CORS and CSRF middleware will automatically validate requests from this origin.
5. In production, session cookies are transmitted with `SameSite=None; Secure; Partitioned`, ensuring login sessions, OTP verifications, and real-time SSE notifications function smoothly across domains.

---

## 7. Operations, Monitoring & Rollbacks

### Inspecting Workflow Runs
- Go to the **Actions** tab in GitHub:
  - **Bookend Frontend CI/CD Pipeline**: Triggers on changes to `client/**` or manual dispatch.
  - **Bookend CI/CD Pipeline**: Triggers on changes to backend or manual dispatch.

### Viewing Container Health & Logs
- In Render Dashboard → **Logs**, monitor frontend Nginx logs:
  ```
  20-envsubst-on-templates.sh: Running envsubst on /etc/nginx/templates/default.conf.template to /etc/nginx/conf.d/default.conf
  Configuration complete; ready for start up
  start worker process
  ```
- Test health from terminal:
  ```bash
  # Test frontend health
  curl -i https://<your-frontend-service>.onrender.com/healthz

  # Test backend health
  curl -i https://bookend-backend-7y88.onrender.com/api/health
  ```

### Rollback Procedure
If a production release introduces a bug:
1. Identify the previous stable Git commit SHA (e.g., `a1b2c3d`).
2. In Docker Hub, verify the image tag exists:
   - Frontend: `<username>/bookend-frontend:<previous-sha>`
   - Backend: `<username>/bookend-backend:<previous-sha>`
3. In Render Dashboard:
   - Navigate to the respective service → **Settings** → **Image URL**.
   - Change tag from `latest` to the exact `<previous-sha>`.
   - Click **Save Changes** → **Manual Deploy** → **Deploy latest image**.

---

## 8. Security & Credential Rotation

If any secret or token is compromised:
1. **Docker Hub Token:** Revoke in Docker Hub Account Settings, generate a replacement, and update `DOCKERHUB_TOKEN` in GitHub Secrets.
2. **Render Deploy Hooks:** In Render Settings → Deploy Hook, delete the compromised hook, generate a new one, and update `RENDER_FRONTEND_DEPLOY_HOOK` or `RENDER_DEPLOY_HOOK` in GitHub Secrets.
3. **JWT Secret:** Generate a new 32-byte hexadecimal string (`openssl rand -hex 32`) and update `JWT_SECRET` in Render backend environment settings.
4. **Public Exposure Notice:** `VITE_*` variables (such as `VITE_API_BASE_URL`) are public to browser users and baked into the frontend bundle. Never store database credentials, private keys, or passwords in `client/` or `VITE_*` variables.
