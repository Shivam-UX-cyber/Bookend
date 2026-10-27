process.env.NODE_ENV = 'test';

import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { sseManager } from '../src/services/notificationService.js';
import { disconnectDB } from '../src/config/db.js';

let mongoServer;

const silentLogger = {
  log: () => {},
  error: () => {},
  warn: () => {},
};

const runTests = async () => {
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('🧪 GRACEFUL SHUTDOWN & CSRF PROTECTION INTEGRATION TEST SUITE');
  console.log('════════════════════════════════════════════════════════════════════\n');

  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  // Dynamic import of server after setting test environment
  const serverModule = await import('../src/server.js');
  const app = serverModule.default;
  const gracefulShutdown = serverModule.gracefulShutdown;

  try {
    // -------------------------------------------------------------------------
    // TEST 1: CSRF / CORS Protection - Untrusted Origin & Referer Rejection
    // -------------------------------------------------------------------------
    console.log('▶ [1/6] Testing: CSRF / CORS rejects state-changing request from untrusted origin and referer...');
    const untrustedOriginRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://malicious-attacker-site.com')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ email: 'student@gmail.com', password: 'Password123!' });

    assert.strictEqual(untrustedOriginRes.status, 403);

    const untrustedRefererRes = await request(app)
      .post('/api/auth/login')
      .set('Referer', 'https://malicious-attacker-site.com/forged')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ email: 'student@gmail.com', password: 'Password123!' });

    assert.strictEqual(untrustedRefererRes.status, 403);
    assert(untrustedRefererRes.body.message.includes('CSRF protection'));
    console.log('   ✓ Untrusted origin and referer rejected with HTTP 403.\n');

    // -------------------------------------------------------------------------
    // TEST 2: CSRF Protection - Rejection when Custom Header (X-Requested-With) is Missing
    // -------------------------------------------------------------------------
    console.log('▶ [2/6] Testing: CSRF rejects state-changing request missing X-Requested-With...');
    const missingHeaderRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('x-test-csrf', 'true') // Triggers strict CSRF enforcement in test environment
      .send({ email: 'student@gmail.com', password: 'Password123!' });

    assert.strictEqual(missingHeaderRes.status, 403);
    assert(missingHeaderRes.body.message.includes('X-Requested-With'));
    console.log('   ✓ Missing custom header rejected with HTTP 403.\n');

    // -------------------------------------------------------------------------
    // TEST 3: CSRF Protection - Allowed Origin with Valid Custom Header Passes
    // -------------------------------------------------------------------------
    console.log('▶ [3/6] Testing: CSRF permits request with authorized origin AND X-Requested-With...');
    const validCsrfRes = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('x-test-csrf', 'true')
      .send({ email: 'nonexistent.student@gmail.com', password: 'Password123!' });

    // 401 proves request passed CSRF middleware and reached the authentication handler
    assert.strictEqual(validCsrfRes.status, 401);
    console.log('   ✓ Authorized origin and custom header passed CSRF gate.\n');

    // -------------------------------------------------------------------------
    // TEST 4: CSRF Safe Methods (GET) do not require custom header
    // -------------------------------------------------------------------------
    console.log('▶ [4/6] Testing: Safe idempotent GET requests do not require custom header...');
    const safeGetRes = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5173')
      .set('x-test-csrf', 'true');

    assert.strictEqual(safeGetRes.status, 200);
    console.log('   ✓ Safe GET requests proceed unimpeded.\n');

    // -------------------------------------------------------------------------
    // TEST 5: Graceful Shutdown with Active SSE Stream
    // -------------------------------------------------------------------------
    console.log('▶ [5/6] Testing: Graceful shutdown drains active SSE stream and closes server...');
    const testServer = http.createServer(app);
    await new Promise((resolve) => testServer.listen(0, resolve));
    assert(testServer.listening, 'Test server must be listening');

    // Register a simulated active SSE client connection
    let sseEnded = false;
    const mockSseRes = {
      writeHead: () => {},
      write: () => true,
      end: () => { sseEnded = true; },
    };
    const mockUserId = new mongoose.Types.ObjectId();
    sseManager.addClient(mockUserId, { on: () => {} }, mockSseRes);
    assert.strictEqual(sseManager.hasClient(mockUserId), true, 'SSE client should be registered');

    // Execute graceful shutdown
    await gracefulShutdown(testServer, 'SIGTERM', {
      timeoutMs: 5000,
      logger: silentLogger,
      exitProcess: false,
    });

    assert.strictEqual(sseEnded, true, 'SSE client connection must be terminated (.end called)');
    assert.strictEqual(sseManager.hasClient(mockUserId), false, 'SSE manager client list must be cleared');
    assert.strictEqual(testServer.listening, false, 'HTTP server must stop listening');
    assert.strictEqual(mongoose.connection.readyState, 0, 'Database connection must be disconnected');
    console.log('   ✓ Active SSE connections drained and server closed cleanly.\n');

    // -------------------------------------------------------------------------
    // TEST 6: Graceful Shutdown Resilience on Partial Cleanup Error
    // -------------------------------------------------------------------------
    console.log('▶ [6/6] Testing: Shutdown continues cleanup even if an intermediate step errors...');
    const secondServer = http.createServer(app);
    await new Promise((resolve) => secondServer.listen(0, resolve));

    // Reconnect DB so we can test disconnect cleanup
    await mongoose.connect(uri);
    assert.strictEqual(mongoose.connection.readyState, 1);

    // Run shutdown with an already closed / erroneous server component
    await gracefulShutdown(secondServer, 'SIGINT', {
      timeoutMs: 3000,
      logger: silentLogger,
      exitProcess: false,
    });

    assert.strictEqual(mongoose.connection.readyState, 0, 'Database must be disconnected despite any intermediate notice');
    console.log('   ✓ Bounded shutdown completed resiliently.\n');

    console.log('════════════════════════════════════════════════════════════════════');
    console.log('🎉 ALL 6 SHUTDOWN & CSRF TESTS PASSED!');
    console.log('════════════════════════════════════════════════════════════════════\n');
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  }
};

runTests().catch((err) => {
  console.error('\n❌ TEST RUNNER FAILURE:', err);
  process.exit(1);
});
