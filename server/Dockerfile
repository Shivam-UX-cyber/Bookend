# ==============================================================================
# Bookend Backend — Multi-Stage Production Dockerfile
# Base: Node.js 20 LTS (Alpine)
# Context: ./server
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Dependencies Resolution (Production Only)
# ------------------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Install dependencies using package-lock.json for 100% reproducible builds
COPY package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

# ------------------------------------------------------------------------------
# Stage 2: Minimal Runtime Image
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Establish baseline production environment defaults
ENV NODE_ENV=production
ENV PORT=5000

# Copy production dependencies and application source with non-root ownership
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

# Run as non-root user for container security hardening
USER node

# Default port documentation (Render dynamically overrides PORT at runtime)
EXPOSE 5000

# Container healthcheck querying /api/health respecting dynamically assigned PORT
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const port = process.env.PORT || 5000; require('http').get('http://127.0.0.1:' + port + '/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Direct node invocation as PID 1 guarantees graceful SIGTERM / SIGINT shutdown
CMD ["node", "src/server.js"]
