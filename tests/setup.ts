import { beforeEach } from 'vitest';
import { resetLogBuffer } from '../src/lib/log-buffer.js';

// Reset log buffer state between tests for isolation
beforeEach(() => {
  resetLogBuffer();
});
