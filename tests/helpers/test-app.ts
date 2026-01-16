import { Hono } from 'hono';
import routes from '../../src/routes/index.js';
import { getLogBuffer } from '../../src/lib/log-buffer.js';

interface CreateTestAppOptions {
  apiKey?: string;
  bufferSize?: number;
}

/**
 * Creates an isolated Hono app instance for testing
 */
export function createTestApp(options: CreateTestAppOptions = {}) {
  const { apiKey, bufferSize = 100 } = options;

  // Initialize buffer with configured size
  getLogBuffer(bufferSize);

  const app = new Hono();

  // Optional API key authentication (mirrors server.ts logic)
  if (apiKey) {
    app.use('/api/*', async (c, next) => {
      const key = c.req.header('X-API-KEY') || c.req.query('apiKey');

      // Allow SSE without auth for convenience
      if (c.req.path === '/api/logs/stream' && !key) {
        return next();
      }

      if (key !== apiKey) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      return next();
    });
  }

  app.route('/api', routes);

  return app;
}
