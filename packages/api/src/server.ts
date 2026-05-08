#!/usr/bin/env bun
import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import routes from './routes/index.js';
import { createRateLimiterMiddleware, resetRateLimiter } from './middleware/rate-limiter.js';
import { createValidatorMiddleware } from './middleware/validator.js';
import { resetLogBuffer, getLogBuffer } from './lib/log-buffer.js';
import { resetMetricBuffer } from './lib/metric-buffer.js';
import { resetTraceBuffer } from './lib/trace-buffer.js';
import { resetIdPool } from './lib/id-pool.js';
import { getDatabase, resetDatabase } from './lib/database.js';

// Configuration from environment
const PORT = parseInt(process.env.PORT || '4000', 10);
const API_KEY = process.env.API_KEY;
const IS_DEV = process.env.NODE_ENV !== 'production';
const envCors = process.env.CORS_ORIGIN || 'http://localhost:4001,http://localhost:5173';
const CORS_ORIGIN = envCors === '*'
  ? '*'
  : envCors.split(',').map((o) => o.trim()).filter(Boolean);
const ENABLE_RATE_LIMIT = process.env.ENABLE_RATE_LIMIT !== 'false';
// SECURITY: Trust proxy headers only when explicitly enabled
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
// In production, API_KEY is required unless ALLOW_ANON=true is set explicitly.
const ALLOW_ANON = process.env.ALLOW_ANON === 'true';

// Graceful shutdown configuration
const SHUTDOWN_TIMEOUT = parseInt(process.env.SHUTDOWN_TIMEOUT || '30000', 10);

// Create Hono app
const app = new Hono();

// Middleware
app.use('*', cors({ origin: CORS_ORIGIN }));
app.use('*', logger());

// Rate limiting middleware (optional, enabled by default)
if (ENABLE_RATE_LIMIT) {
  app.use('/api/*', createRateLimiterMiddleware());
  app.use('/v1/*', createRateLimiterMiddleware());
  if (!TRUST_PROXY && !IS_DEV) {
    console.warn('⚠️  Rate limiting active without TRUST_PROXY=true. Clients identified by User-Agent hash (less precise). Set TRUST_PROXY=true behind a reverse proxy.');
  }
}

// Input validation middleware for standard log ingestion (not OTLP)
app.use('/api/logs', createValidatorMiddleware());

// Payload size limit for OTLP endpoints
const MAX_OTLP_PAYLOAD = parseInt(process.env.MAX_PAYLOAD_SIZE || '1048576', 10);
app.use('/v1/*', async (c, next) => {
  if (c.req.method !== 'POST') return next();
  const contentLength = c.req.header('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_OTLP_PAYLOAD) {
    return c.json({ error: 'Payload Too Large' }, 413);
  }
  return next();
});

// API key authentication (opt-in: set API_KEY env var to enable)
if (API_KEY) {
  const apiKeyBuffer = Buffer.from(API_KEY);
  const authMiddleware = async (c: any, next: any) => {
    const key = c.req.header('X-API-KEY');
    if (!key) {
      return c.json({ error: 'Unauthorized', message: 'Valid API key required' }, 401);
    }
    const keyBuffer = Buffer.from(key);
    if (keyBuffer.length !== apiKeyBuffer.length || !crypto.timingSafeEqual(keyBuffer, apiKeyBuffer)) {
      return c.json({ error: 'Unauthorized', message: 'Valid API key required' }, 401);
    }
    return next();
  };
  app.use('/api/*', authMiddleware);
  app.use('/v1/*', authMiddleware);
} else if (!IS_DEV) {
  if (!ALLOW_ANON) {
    console.error('FATAL: API_KEY is required in production. Set API_KEY (openssl rand -base64 32) or ALLOW_ANON=true to opt into anonymous access. Exiting.');
    process.exit(1);
  }
  console.warn('\n⚠️  WARNING: Running in production with ALLOW_ANON=true. All endpoints are unauthenticated.\n');
}

// SECURITY: Add security headers to all responses
app.use('*', async (c, next) => {
  await next();

  // Prevent MIME type sniffing
  c.header('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking
  c.header('X-Frame-Options', 'DENY');

  // XSS protection (legacy browsers)
  c.header('X-XSS-Protection', '1; mode=block');

  // Referrer policy - don't leak URLs
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Content Security Policy (relaxed for dashboard)
  if (!IS_DEV) {
    c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
  }

  // HSTS - only in production with HTTPS
  if (!IS_DEV && c.req.header('x-forwarded-proto') === 'https') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});

// Main standard and OTLP REST routes under the same router instance
// The index routes define /api/, /v1/logs, /v1/traces, /v1/metrics
app.route('/', routes);

// Health check with detailed status
app.get('/health', (c) => {
  const buffer = getLogBuffer();

  return c.json({
    status: 'ok',
    uptime: process.uptime(),
    channels: buffer.channelCount,
  });
});

// Serve dashboard static files (only in production)
const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardPath = join(__dirname, '../../dashboard/dist');
const shouldServeDashboard = !IS_DEV && existsSync(dashboardPath);

if (shouldServeDashboard) {
  // Serve static files with absolute path
  const resolvedDashboardPath = resolve(dashboardPath);
  app.get('/*', async (c, next) => {
    const path = c.req.path === '/' ? '/index.html' : c.req.path;
    const filePath = resolve(join(dashboardPath, path));

    if (!filePath.startsWith(resolvedDashboardPath)) {
      return next();
    }

    if (existsSync(filePath)) {
      const file = Bun.file(filePath);
      return new Response(file);
    }

    // SPA fallback - serve index.html for non-file routes
    if (!path.includes('.')) {
      const file = Bun.file(join(dashboardPath, 'index.html'));
      return new Response(file);
    }

    return next();
  });
} else {
  // Development mode - show message pointing to Vite dev server
  app.get('/', (c) => {
    const devMessage = IS_DEV
      ? `<p><strong>Development mode:</strong> Use <a href="http://localhost:4001">http://localhost:4001</a> for the dashboard (with hot reload).</p>`
      : `<p>Dashboard not built yet. Run <code>pnpm build</code> or use <code>pnpm dev</code> for development.</p>`;

    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>Abbacchio API</title></head>
        <body style="font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto;">
          <h1>Abbacchio API</h1>
          <p><em>Real-time log viewer for Pino, Winston, Bunyan, and more</em></p>
          ${devMessage}
          <h2>API Endpoints</h2>
          <ul>
            <li><code>POST /api/logs</code> - Ingest standard logs</li>
            <li><code>POST /v1/logs</code> - Ingest OTLP JSON logs</li>
            <li><code>POST /v1/metrics</code> - Ingest OTLP JSON metrics</li>
            <li><code>POST /v1/traces</code> - Ingest OTLP JSON traces</li>
            <li><code>GET /api/logs</code> - Get buffered logs</li>
            <li><code>DELETE /api/logs</code> - Clear logs</li>
            <li><code>GET /api/metrics</code> - Get buffered metrics</li>
            <li><code>GET /api/traces</code> - Get buffered traces</li>
            <li><code>GET /api/channels</code> - List channels</li>
            <li><code>GET /api/stats</code> - Server statistics</li>
            <li><code>POST /api/sql</code> - Execute SQL queries</li>
          </ul>
          <h2>Test</h2>
          <pre>curl -X POST http://localhost:${PORT}/api/logs \\
  -H "Content-Type: application/json" \\
  -d '{"level":30,"msg":"Hello from curl"}'</pre>
        </body>
      </html>
    `);
  });
}

// Initialize database eagerly
getDatabase();

// Server state for graceful shutdown
let isShuttingDown = false;

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    console.log('Shutdown already in progress...');
    return;
  }

  isShuttingDown = true;
  console.log(`\n${signal} received. Starting graceful shutdown...`);

  // Set a timeout for shutdown
  const shutdownTimer = setTimeout(() => {
    console.error('Shutdown timeout exceeded, forcing exit...');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);

  try {
    // Close the HTTP server to stop accepting new connections
    server.stop();
    console.log('HTTP server closed');

    // Clean up resources
    resetRateLimiter();
    resetDatabase();
    resetLogBuffer();
    resetMetricBuffer();
    resetTraceBuffer();
    resetIdPool();

    clearTimeout(shutdownTimer);
    console.log('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    clearTimeout(shutdownTimer);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', IS_DEV ? error : error?.message || 'Unknown error');
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('Unhandled rejection:', IS_DEV ? reason : msg);
  gracefulShutdown('unhandledRejection');
});

// Start server
const dbPath = process.env.SQLITE_PATH || './data/logs.db';
const dashboardUrl = IS_DEV ? 'http://localhost:4001' : `http://localhost:${PORT}`;
console.log(`
  ╔═══════════════════════════════════════════╗
  ║                                           ║
  ║   Abbacchio${IS_DEV ? ' (dev)' : ''}                          ║
  ║   Bun + SQLite                            ║
  ║                                           ║
  ║   API:       http://localhost:${PORT}/api/logs  ║
  ║   DB:        ${dbPath.padEnd(28)}║
  ║                                           ║
  ╚═══════════════════════════════════════════╝
`);

const server = Bun.serve({
  fetch: app.fetch,
  port: PORT,
});

// Export for programmatic use
export { app };
export { getLogBuffer, resetLogBuffer } from './lib/log-buffer.js';
export type { LogEntry, IncomingLog, LogLevelLabel } from './types.js';
