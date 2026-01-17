import { beforeEach } from 'vitest';
import { resetLogBuffer } from '../src/lib/log-buffer.js';
import { resetConnectionManager } from '../src/lib/connection-manager.js';
import { resetIdPool } from '../src/lib/id-pool.js';
import { resetRateLimiter } from '../src/middleware/rate-limiter.js';

// Reset all singletons between tests for isolation
beforeEach(() => {
  resetLogBuffer();
  resetConnectionManager();
  resetIdPool();
  resetRateLimiter();
});
