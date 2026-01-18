#!/usr/bin/env node
import 'dotenv/config';
import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import routes from './routes/index.js';
import { createRateLimiterMiddleware, resetRateLimiter } from './middleware/rate-limiter.js';
import { createValidatorMiddleware } from './middleware/validator.js';
import { getConnectionManager, resetConnectionManager } from './lib/connection-manager.js';
import { resetLogBuffer, getLogBuffer } from './lib/log-buffer.js';
import { resetIdPool } from './lib/id-pool.js';

// Configuration from environment
const PORT = parseInt(process.env.PORT || '4000', 10);
const API_KEY = process.env.API_KEY;
// SECURITY: Default CORS to localhost only in production, allow all in dev
const IS_DEV = process.env.NODE_ENV !== 'production';
const CORS_ORIGIN = process.env.CORS_ORIGIN || (IS_DEV ? '*' : 'http://localhost:4001');
const ENABLE_RATE_LIMIT = process.env.ENABLE_RATE_LIMIT !== 'false';
// SECURITY: Trust proxy headers only when explicitly enabled
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
// SECURITY: Require API key in production (warn in dev)
const REQUIRE_API_KEY = process.env.REQUIRE_API_KEY === 'true' || !IS_DEV;

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
}

// Input validation middleware for log ingestion
app.use('/api/logs', createValidatorMiddleware());

// SECURITY: API key authentication
// In production, API_KEY is required for all endpoints
// In development, API_KEY is optional but recommended
if (REQUIRE_API_KEY && !API_KEY) {
  console.warn('\n⚠️  WARNING: API_KEY is not set. Set API_KEY environment variable for production use.\n');
}

if (API_KEY) {
  app.use('/api/*', async (c, next) => {
    const key = c.req.header('X-API-KEY') || c.req.query('apiKey');

    // SECURITY: All endpoints require authentication when API_KEY is set
    // No more bypass for SSE streams - all connections must be authenticated
    if (key !== API_KEY) {
      return c.json({ error: 'Unauthorized', message: 'Valid API key required' }, 401);
    }
    return next();
  });
} else if (REQUIRE_API_KEY) {
  // Block all API requests if API_KEY is required but not set
  app.use('/api/*', async (c) => {
    return c.json({ error: 'Service Unavailable', message: 'API key not configured on server' }, 503);
  });
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

// API routes
app.route('/api', routes);

// Health check with detailed status
app.get('/health', (c) => {
  const connectionManager = getConnectionManager();
  const buffer = getLogBuffer();

  return c.json({
    status: 'ok',
    uptime: process.uptime(),
    connections: connectionManager.size,
    maxConnections: connectionManager.maxConnections,
    channels: buffer.channelCount,
  });
});

// Serve dashboard static files (only in production)
const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardPath = join(__dirname, '../../dashboard/dist');
const shouldServeDashboard = !IS_DEV && existsSync(dashboardPath);

if (shouldServeDashboard) {
  // Serve static files with absolute path
  app.get('/*', async (c, next) => {
    const path = c.req.path === '/' ? '/index.html' : c.req.path;
    const filePath = join(dashboardPath, path);

    if (existsSync(filePath)) {
      const { readFile } = await import('fs/promises');
      const content = await readFile(filePath);

      // Set content type based on extension
      const ext = path.split('.').pop()?.toLowerCase();
      const contentTypes: Record<string, string> = {
        'html': 'text/html',
        'css': 'text/css',
        'js': 'application/javascript',
        'json': 'application/json',
        'svg': 'image/svg+xml',
        'png': 'image/png',
        'ico': 'image/x-icon',
      };
      const contentType = contentTypes[ext || ''] || 'application/octet-stream';

      return c.body(content, 200, { 'Content-Type': contentType });
    }

    // SPA fallback - serve index.html for non-file routes
    if (!path.includes('.')) {
      const { readFile } = await import('fs/promises');
      const content = await readFile(join(dashboardPath, 'index.html'));
      return c.body(content, 200, { 'Content-Type': 'text/html' });
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
            <li><code>POST /api/logs</code> - Ingest logs</li>
            <li><code>GET /api/logs/stream</code> - SSE stream</li>
            <li><code>GET /api/logs</code> - Get buffered logs</li>
            <li><code>DELETE /api/logs</code> - Clear logs</li>
            <li><code>GET /api/stats</code> - Server statistics</li>
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

// Server instance for graceful shutdown
let server: ServerType | null = null;
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

  const connectionManager = getConnectionManager();
  const activeConnections = connectionManager.size;

  if (activeConnections > 0) {
    console.log(`Closing ${activeConnections} active SSE connections...`);
  }

  // Set a timeout for shutdown
  const shutdownTimer = setTimeout(() => {
    console.error('Shutdown timeout exceeded, forcing exit...');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);

  try {
    // Close the HTTP server to stop accepting new connections
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      console.log('HTTP server closed');
    }

    // Clean up resources
    resetConnectionManager();
    resetRateLimiter();
    resetLogBuffer();
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
  console.error('Uncaught exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});

// Start server
const dashboardUrl = IS_DEV ? 'http://localhost:4001' : `http://localhost:${PORT}`;
console.log(`
  ╔═══════════════════════════════════════════╗
  ║                                           ║
  ║   Abbacchio${IS_DEV ? ' (dev)' : ''}                          ║
  ║   Real-time log viewer                    ║
  ║                                           ║
  ║   API:       http://localhost:${PORT}/api/logs  ║
  ║                                           ║
  ╚═══════════════════════════════════════════╝
`);

server = serve({
  fetch: app.fetch,
  port: PORT,
});

// Export for programmatic use
export { app };
export { getLogBuffer, resetLogBuffer } from './lib/log-buffer.js';
export { getConnectionManager, resetConnectionManager } from './lib/connection-manager.js';
export type { LogEntry, IncomingLog, LogLevelLabel } from './types.js';
