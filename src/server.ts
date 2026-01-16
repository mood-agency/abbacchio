#!/usr/bin/env node
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import routes from './routes/index.js';
import { getLogBuffer } from './lib/log-buffer.js';

// Configuration from environment
const PORT = parseInt(process.env.PORT || '4000', 10);
const LOG_BUFFER_SIZE = parseInt(process.env.LOG_BUFFER_SIZE || '1000', 10);
const API_KEY = process.env.API_KEY;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const IS_DEV = process.env.NODE_ENV !== 'production';

// Initialize log buffer with configured size
getLogBuffer(LOG_BUFFER_SIZE);

// Create Hono app
const app = new Hono();

// Middleware
app.use('*', cors({ origin: CORS_ORIGIN }));
app.use('*', logger());

// Optional API key authentication
if (API_KEY) {
  app.use('/api/*', async (c, next) => {
    const key = c.req.header('X-API-KEY') || c.req.query('apiKey');

    // Allow SSE without auth for convenience (can be configured)
    if (c.req.path === '/api/logs/stream' && !key) {
      return next();
    }

    if (key !== API_KEY) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return next();
  });
}

// API routes
app.route('/api', routes);

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Serve dashboard static files (only in production)
const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardPath = join(__dirname, '../dashboard/dist');
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
      : `<p>Dashboard not built yet. Run <code>pnpm build:dashboard</code> or use <code>pnpm dev</code> for development.</p>`;

    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>pino-live API</title></head>
        <body style="font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto;">
          <h1>pino-live API</h1>
          ${devMessage}
          <h2>API Endpoints</h2>
          <ul>
            <li><code>POST /api/logs</code> - Ingest logs</li>
            <li><code>GET /api/logs/stream</code> - SSE stream</li>
            <li><code>GET /api/logs</code> - Get buffered logs</li>
            <li><code>DELETE /api/logs</code> - Clear logs</li>
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

// Start server
const dashboardUrl = IS_DEV ? 'http://localhost:4001' : `http://localhost:${PORT}`;
console.log(`
  ╔═══════════════════════════════════════════╗
  ║                                           ║
  ║   pino-live${IS_DEV ? ' (dev)' : ''}                          ║
  ║                                           ║
  ║   Dashboard: ${dashboardUrl.padEnd(27)}║
  ║   API:       http://localhost:${PORT}/api/logs  ║
  ║                                           ║
  ╚═══════════════════════════════════════════╝
`);

serve({
  fetch: app.fetch,
  port: PORT,
});
