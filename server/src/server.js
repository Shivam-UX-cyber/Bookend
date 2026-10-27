import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config, validateEnv } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { sseManager } from './services/notificationService.js';
import authRoutes from './routes/authRoutes.js';
import bookRoutes from './routes/bookRoutes.js';
import purchaseRequestRoutes from './routes/purchaseRequestRoutes.js';
import userRoutes from './routes/userRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import { csrfProtection } from './middleware/csrfMiddleware.js';

const app = express();

// Configure Express proxy trust for reverse proxies (e.g. Render edge load balancer: 1 hop in production)
app.set('trust proxy', config.trustProxy);

// Validate environment variables on startup (throws on fatal configuration)
if (process.env.NODE_ENV !== 'test') {
  try {
    const envWarnings = validateEnv();
    if (envWarnings.length > 0) {
      console.log('\n\x1b[33m%s\x1b[0m', '═════════════════ CONFIGURATION NOTICES ═════════════════');
      envWarnings.forEach((warning) => {
        console.log('\x1b[33m%s\x1b[0m', `• ${warning}`);
      });
      console.log('\x1b[33m%s\x1b[0m', '══════════════════════════════════════════════════════════\n');
    }
  } catch (fatalEnvError) {
    console.error('\x1b[31m%s\x1b[0m', `\n[FATAL CONFIGURATION ERROR] ${fatalEnvError.message}\n`);
    process.exit(1);
  }
}

// 1. Security Headers via Helmet
app.use(
  helmet({
    contentSecurityPolicy: config.nodeEnv === 'production',
    crossOriginEmbedderPolicy: false,
  })
);

// 2. Cross-Origin Resource Sharing (CORS) with credentials support
// Normalize origins by trimming whitespace and trailing slashes; support comma-separated origins
const rawOrigins = (config.clientUrl || '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const allowedOrigins = config.nodeEnv === 'production'
  ? rawOrigins
  : Array.from(new Set([...rawOrigins, 'http://localhost:5173', 'http://127.0.0.1:5173']));

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or same-origin)
      if (!origin) {
        return callback(null, true);
      }
      const cleanOrigin = origin.trim().replace(/\/+$/, '');
      if (allowedOrigins.includes(cleanOrigin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked request from origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// 3. Request Parsers
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// 4. Global Request Rate Limiter (bypassed in test environment)
if (process.env.NODE_ENV !== 'test') {
  app.use('/api', generalLimiter);
}

// 5. CSRF Protection for state-changing requests
app.use('/api', csrfProtection(allowedOrigins));

// 5. Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'Campus Book Exchange Auth API',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

// 6. Mount Authentication, Marketplace, Purchase Request, and User Profile Routes
app.use('/api/auth', authRoutes);
app.use('/api/books', bookRoutes);
app.use('/api/purchase-requests', purchaseRequestRoutes);
app.use('/api/users', userRoutes);
app.use('/api/notifications', notificationRoutes);

// 7. Handle Unmatched Routes (404)
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint not found: ${req.method} ${req.originalUrl}`,
  });
});

// 8. Centralized Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);

  // Handle Mongoose duplicate key error (code 11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({
      success: false,
      message: `An entry with this ${field} already exists.`,
    });
  }

  // Handle CORS errors
  if (err.message && err.message.startsWith('CORS blocked')) {
    return res.status(403).json({
      success: false,
      message: err.message,
    });
  }

  const statusCode = err.statusCode || 500;
  const message = config.nodeEnv === 'production' && statusCode === 500
    ? 'An unexpected internal server error occurred.'
    : err.message || 'Server error';

  res.status(statusCode).json({
    success: false,
    message,
    ...(config.nodeEnv !== 'production' && { stack: err.stack }),
  });
});

// Initialize Database and Start Server
export const startServer = async () => {
  try {
    await connectDB();
  } catch (dbError) {
    console.error('\x1b[31m%s\x1b[0m', `\n[FATAL] Database connection failed: ${dbError.message}`);
    console.error('\x1b[31m%s\x1b[0m', '[FATAL] Server startup aborted. The HTTP server will NOT listen without a working database connection.\n');
    process.exit(1);
  }

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log('\x1b[32m%s\x1b[0m', `[Server] Campus Book Exchange API running on port ${config.port} (${config.nodeEnv})`);
    console.log('\x1b[36m%s\x1b[0m', `[Server] Allowed Origins: ${allowedOrigins.join(', ')}`);
    console.log('\x1b[36m%s\x1b[0m', `[Server] Health Endpoint: http://localhost:${config.port}/api/health`);
    const isConfigured = Boolean(config.email.resendApiKey);
    const maskedKey = isConfigured
      ? `${config.email.resendApiKey.slice(0, 5)}...${config.email.resendApiKey.slice(-4)}`
      : 'NOT_SET';
    console.log(
      '\x1b[36m%s\x1b[0m',
      `[Server] Email Delivery Engine: Provider=Resend HTTPS API | From=${config.email.from} | KeyConfigured=${isConfigured} (${maskedKey})`
    );
  });

  process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));

  return server;
};

/**
 * Bounded Graceful Shutdown Handler
 *
 * 1. Establishes a hard timeout fallback.
 * 2. Closes active SSE client streams to unblock server.close().
 * 3. Stops accepting new requests and drains in-flight requests.
 * 4. Cleanly disconnects the database connection.
 */
export const gracefulShutdown = async (server, signal, { timeoutMs = 10000, logger = console, exitProcess = true } = {}) => {
  logger.log(`\n[Server] Received ${signal}. Starting bounded graceful shutdown...`);

  let forceTimer = null;
  if (exitProcess) {
    forceTimer = setTimeout(() => {
      logger.error(`[Server] Graceful shutdown timed out after ${timeoutMs}ms. Forcing process exit.`);
      process.exit(1);
    }, timeoutMs);
    if (forceTimer.unref) forceTimer.unref();
  }

  // 1. Terminate all active Server-Sent Events (SSE) connections
  try {
    sseManager.closeAll();
    logger.log('[Server] Active SSE streams closed.');
  } catch (sseErr) {
    logger.error('[Server Error: SSE stream draining failed]', sseErr.message);
  }

  // 2. Stop accepting new HTTP connections and drain in-flight requests
  try {
    if (server && server.listening) {
      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) return reject(err);
          resolve();
        });
      });
      logger.log('[Server] HTTP listener closed and in-flight requests drained.');
    }
  } catch (closeErr) {
    logger.error('[Server Error: HTTP close failed]', closeErr.message);
  }

  // 3. Cleanly disconnect MongoDB database connection
  try {
    await disconnectDB();
    logger.log('[Server] MongoDB connection closed cleanly.');
  } catch (dbErr) {
    logger.error('[Server Error: Database disconnection failed]', dbErr.message);
  }

  if (forceTimer) clearTimeout(forceTimer);

  logger.log('[Server] Graceful shutdown completed cleanly.');
  if (exitProcess) {
    process.exit(0);
  }
};

// Start server automatically only when run directly (not when imported in tests)
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export default app;
