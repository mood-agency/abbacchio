import { beforeEach } from 'bun:test';
import { resetLogBuffer } from '../src/lib/log-buffer.js';
import { resetIdPool } from '../src/lib/id-pool.js';
import { resetRateLimiter } from '../src/middleware/rate-limiter.js';
import { resetMetricBuffer } from '../src/lib/metric-buffer.js';
import { resetTraceBuffer } from '../src/lib/trace-buffer.js';
import { resetDatabase } from '../src/lib/database.js';

// Reset all singletons between tests for isolation
beforeEach(() => {
  resetDatabase();
  resetLogBuffer();
  resetIdPool();
  resetRateLimiter();
  resetMetricBuffer();
  resetTraceBuffer();
});
