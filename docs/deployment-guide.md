# Bookend — Production Deployment & Operations Guide

This guide provides end-to-end instructions for configuring, deploying, operating, and troubleshooting Bookend across GitHub Actions, Docker Hub, Render, and Vercel.

---

## 1. Repository Structure & Deployment Architecture

```
Developer Push → GitHub (main/master) 
                    │
                    ▼
          GitHub Actions CI/CD
         ├── Frontend CI (npm test, vite build)
         └── Backend CI (npm test, security & integration suites)
                    │
                    ▼ (Pass Gate)
          Docker Image Build (./server)
                    │
                    ▼
          Docker Hub Registry
          ├── <username>/bookend-backend:<commit-sha>
          └── <username>/bookend-backend:latest
                    │
                    ▼ (Webhook with ?imgURL=...)
          Render Web Service (Backend API)
          └── Prebuilt Docker Image Deployment
                    ▲
                    │ HTTPS API Requests (Credentials: Include)
                    │ Cross-Site Cookies (SameSite=None; Secure)
                    │
          Vercel Deployment (Frontend React App)
```

### Component Distribution
- **Frontend:** React 19 + Vite deployed to **Vercel**. Communicates with the backend over HTTPS via `VITE_API_BASE_URL`.
- **Backend:** Node.js 20 + Express 4 deployed as a prebuilt container to **Render**.
- **Database:** MongoDB Atlas cluster with replica set support.
- **Image Registry:** Docker Hub hosting immutable commit-SHA tagged images.
- **CI/CD Orchestration:** GitHub Actions workflow (`.github/workflows/bookend-ci-cd.yml`).

---

## 2. Local Development Quickstart

### Prerequisites
- Node.js 20.x or higher
- MongoDB instance (local or MongoDB Atlas connection URI)
- Git

### Backend Setup
```bash
cd server
cp .env.example .env
# Edit .env with your local MongoDB URI and configuration
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

The Dockerfile is situated at `./server/Dockerfile` and expects the build context to be `./server`.

### Build Image
```bash
docker build -t bookend-backend ./server
```

### Run Container Locally
```bash
docker run --rm -p 5000:5000 \
  -e PORT=5000 \
  -e NODE_ENV=production \
  -e CLIENT_URL=http://localhost:5173 \
  -e MONGO_URI="mongodb+srv://<username>:<password>@<cluster>.mongodb.net/bookend?retryWrites=true&w=majority" \
  -e JWT_SECRET="your_secure_random_production_secret_at_least_32_characters" \
  bookend-backend
```

### Test Container Healthcheck
```bash
curl -i http://localhost:5000/api/health
```
Expected response:
```json
{
  "status": "healthy",
  "service": "Campus Book Exchange Auth API",
  "timestamp": "2026-10-25T...",
  "environment": "production"
}
```

---

## 4. Git Repository Setup & Safe Initial Push

Before pushing code to a new remote repository:

1. **Verify No Live Secrets Are Tracked:**
   Ensure no `.env` files, production credentials, or `node_modules` are staged.
   ```bash
   git status
   ```

2. **Initialize Git Repository (if not already initialized):**
   ```bash
   git init
   git branch -M main
   ```

3. **Stage and Commit Clean Codebase:**
   ```bash
   git add .
   git commit -m "feat: complete Bookend implementation with CI/CD and Docker configuration"
   ```

4. **Add Remote and Push:**
   ```bash
   git remote add origin https://github.com/<your-github-username>/<your-repo-name>.git
   git push -u origin main
   ```

---

## 5. Docker Hub Setup

1. Log in to [hub.docker.com](https://hub.docker.com).
2. Create a new repository named `bookend-backend`.
   - Set visibility to **Public** (or **Private**; if Private, see Registry Credentials section below).
3. Generate an Access Token:
   - Go to **Account Settings** → **Security** → **Personal Access Tokens**.
   - Click **Generate New Token**.
   - Description: `bookend-github-actions`.
   - Access permissions: **Read & Write** (or Read, Write, Delete if managing tags).
   - Copy the generated token immediately (you will not be able to view it again).

---

## 6. GitHub Actions Configuration

In your GitHub repository, navigate to **Settings** → **Secrets and variables** → **Actions**.

### Repository Variables (Variables Tab)
| Variable Name | Example Value | Description |
|---|---|---|
| `DOCKERHUB_USERNAME` | `yourdockerhubuser` | Your Docker Hub account username |

### Repository Secrets (Secrets Tab)
| Secret Name | Example Placeholder | Description |
|---|---|---|
| `DOCKERHUB_TOKEN` | `dckr_pat_xxxx...` | Personal Access Token generated in Docker Hub |
| `RENDER_DEPLOY_HOOK` | `https://api.render.com/deploy/srv-xxx?key=yyy` | Webhook URL from your Render service |

---

## 7. Render Web Service Setup

1. Log in to [render.com](https://render.com) and click **New +** → **Web Service**.
2. Select **Deploy an existing image from a registry**.
3. Image URL:
   - For Public repository: `docker.io/<your-dockerhub-username>/bookend-backend:latest`
   - For Private repository: Click **Add Image Registry Credential** and provide your Docker Hub username and a read-only Docker Hub Personal Access Token.
4. Name your service (e.g. `bookend-backend`).
5. Choose region, instance type (Free / Starter), and environment settings.
6. Under **Advanced Settings**:
   - Health Check Path: `/api/health`
7. Click **Create Web Service**.
8. In the newly created service dashboard:
   - Navigate to **Settings** → **Deploy Hook**.
   - Click **Create Deploy Hook** or copy the existing URL.
   - Add this URL to your GitHub repository secrets as `RENDER_DEPLOY_HOOK`.

### Render Runtime Environment Variables
In Render, navigate to **Environment** and add the following variables:

| Environment Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | Set to `production` |
| `PORT` | Auto | Render automatically sets this (e.g. `10000`); our Dockerfile binds dynamically |
| `CLIENT_URL` | Yes | URL of your Vercel frontend, e.g. `https://bookend.vercel.app` (no trailing slash) |
| `MONGO_URI` | Yes | MongoDB Atlas connection string (use replica set cluster URI) |
| `JWT_SECRET` | Yes | High-entropy string (min 32 characters, e.g. generated via `openssl rand -hex 32`) |
| `JWT_EXPIRES_IN` | No | Defaults to `7d` |
| `COOKIE_SAME_SITE` | No | Defaults to `none` in production (required for cross-site Vercel-to-Render cookies) |
| `COOKIE_SECURE` | No | Defaults to `true` in production |
| `SMTP_HOST` | Yes | E.g. `smtp.gmail.com` |
| `SMTP_PORT` | Yes | E.g. `465` |
| `SMTP_SECURE` | Yes | E.g. `true` |
| `EMAIL_USER` | Yes | Gmail address for sending OTPs |
| `EMAIL_APP_PASSWORD` | Yes | 16-character Google App Password (never personal password) |

---

## 8. Vercel Frontend Configuration

1. Import your GitHub repository into [vercel.com](https://vercel.com).
2. Configure project root directory to `client`.
3. Framework Preset: **Vite**.
4. In **Project Settings** → **Environment Variables**, add:

| Variable Name | Value | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `https://<your-render-service>.onrender.com` | Base URL of your backend API on Render (no trailing slash) |

5. Deploy project. Once deployed, copy the production Vercel domain (e.g. `https://bookend.vercel.app`) and ensure it matches `CLIENT_URL` in your Render backend settings.

---

## 9. Operations, Monitoring & Rollbacks

### Inspecting Workflow Runs
- Go to the **Actions** tab in GitHub to view real-time CI logs for Frontend CI, Backend CI, Docker build, and Render deployment dispatch.

### Viewing Container Health & Logs
- In Render Dashboard → **Logs**, monitor application startup logs:
  ```
  [Server] Campus Book Exchange API running on port 10000 (production)
  [Server] Allowed Origins: https://bookend.vercel.app
  [Server] Health Endpoint: http://localhost:10000/api/health
  [Database] MongoDB Connected: cluster0-shard-00-00.mongodb.net
  ```
- Test health from terminal:
  ```bash
  curl -i https://<your-render-service>.onrender.com/api/health
  ```

### Rollback Procedure
If a production deployment causes unexpected errors:
1. Identify the previous stable Git commit SHA.
2. In Docker Hub, verify that the image tag `bookend-backend:<previous-sha>` exists.
3. In Render Dashboard:
   - Navigate to **Settings** → **Image URL**.
   - Change tag to `docker.io/<username>/bookend-backend:<previous-sha>`.
   - Click **Save Changes** → **Manual Deploy** → **Deploy latest image**.

---

## 10. Credential Rotation & Incident Response

If a secret is ever exposed or compromised:

1. **MongoDB Credentials:**
   - Go to MongoDB Atlas → **Database Access**.
   - Edit the user password or delete the user and create a replacement.
   - Update `MONGO_URI` in Render Environment settings. Render will automatically redeploy.

2. **JWT Secret:**
   - Generate a new random secret (`openssl rand -hex 32`).
   - Update `JWT_SECRET` in Render.
   - Existing active sessions will be invalidated safely, requiring users to log in again.

3. **Docker Hub Token:**
   - In Docker Hub → **Account Settings** → **Security**, delete the compromised token.
   - Generate a new token and update `DOCKERHUB_TOKEN` in GitHub Secrets.

4. **Render Deploy Hook:**
   - In Render Dashboard → **Settings** → **Deploy Hook**, delete the hook and create a new one.
   - Update `RENDER_DEPLOY_HOOK` in GitHub Secrets.

5. **Gmail App Password:**
   - In Google Account Security → **App Passwords**, revoke the existing password.
   - Generate a new 16-character password and update `EMAIL_APP_PASSWORD` in Render.
