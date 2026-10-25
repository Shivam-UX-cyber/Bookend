# ==============================================================================
# Bookend Frontend — Multi-Stage Production Dockerfile
# Stage 1: Build React 19 + Vite application bundle
# Stage 2: Serve production assets with Alpine Nginx and dynamic PORT resolution
# Context: ./client
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build Application Bundle
# ------------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies using package-lock.json for 100% reproducible builds
COPY package.json package-lock.json ./

RUN npm ci --ignore-scripts && \
    npm cache clean --force

# Production API URL injected at build-time (Vite bakes VITE_* into static assets)
# Defaults to the production Render backend service URL
ARG VITE_API_BASE_URL=https://bookend-backend-7y88.onrender.com
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# Copy frontend source code (respects client/.dockerignore)
COPY . .

# Build the production bundle into /app/dist
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Lightweight Production Nginx Runtime
# ------------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runner

WORKDIR /usr/share/nginx/html

# Establish default runtime port; Render dynamically overrides $PORT (e.g. 10000)
ENV PORT=80

# Restrict envsubst execution to ONLY substitute $PORT into Nginx template,
# guaranteeing native Nginx variables ($uri, $host, etc.) remain untouched
ENV NGINX_ENVSUBST_FILTER="^PORT$"

# Clear default static files from standard Nginx image
RUN rm -rf /usr/share/nginx/html/*

# Copy compiled static assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy dynamic Nginx configuration template (automatically processed by Nginx entrypoint)
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Document default listening port
EXPOSE 80

# Container healthcheck querying /healthz respecting dynamically assigned $PORT
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:${PORT}/healthz || exit 1

# Start Nginx in foreground mode
CMD ["nginx", "-g", "daemon off;"]
