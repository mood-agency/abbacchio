import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { beforeEach } from 'bun:test';
import { resetLogBuffer } from '../src/lib/log-buffer.js';
import { resetIdPool } from '../src/lib/id-pool.js';
import { resetRateLimiter } from '../src/middleware/rate-limiter.js';
import { resetMetricBuffer } from '../src/lib/metric-buffer.js';
import { resetTraceBuffer } from '../src/lib/trace-buffer.js';
import { resetDatabase } from '../src/lib/database.js';

// Use a temporary directory for test databases so tests never write to the
// production ./data/logs.db file. Each test run gets a fresh temp dir; each
// beforeEach creates a new DB file via the counter to avoid WAL lock issues.
const testDir = mkdtempSync(join(tmpdir(), 'abbacchio-test-'));
let testDbCounter = 0;

// Reset all singletons between tests for isolation
beforeEach(() => {
  testDbCounter++;
  process.env.SQLITE_PATH = join(testDir, `test-${testDbCounter}.db`);
  resetDatabase();
  resetLogBuffer();
  resetIdPool();
  resetRateLimiter();
  resetMetricBuffer();
  resetTraceBuffer();
});
