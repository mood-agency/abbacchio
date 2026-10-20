import { describe, it, expect } from 'bun:test';
import { createTestApp } from '../helpers/test-app.js';
import { sampleLog, sampleLogs, winstonStyleLog, createLogBatch, createLogWithExtras } from '../helpers/fixtures.js';
import { getLogBuffer } from '../../src/lib/log-buffer.js';

describe('POST /api/logs', () => {
  describe('single log ingestion', () => {
    it('should accept a single log and return 201', async () => {
      const app = createTestApp();
      const response = await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleLog),
      });

      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json).toEqual({ received: 1, channel: 'default' });
    });

    it('should update channel logCount when log is ingested', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();

      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 30, msg: 'Stored log' }),
      });

      const info = buffer.getChannelInfo('default');
      expect(info?.logCount).toBeGreaterThanOrEqual(1);
    });

    it('should normalize Winston-style logs', async () => {
      const app = createTestApp();

      const response = await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(winstonStyleLog),
      });

      expect(response.status).toBe(201);
    });

    it('should accept all log levels', async () => {
      const app = createTestApp();

      for (const [_label, log] of Object.entries(sampleLogs)) {
        const response = await app.request('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(log),
        });
        expect(response.status).toBe(201);
      }
    });

    it('should accept logs with extra fields', async () => {
      const app = createTestApp();

      const logWithExtras = createLogWithExtras({
        userId: 123,
        requestId: 'abc-123',
        metadata: { key: 'value' },
      });

      const response = await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logWithExtras),
      });

      expect(response.status).toBe(201);
    });

    it('should accept network telemetry logs', async () => {
      const app = createTestApp();
      const networkLog = {
        level: 30,
        msg: 'browser network request',
        req: {
          method: 'POST',
          url: 'https://api.example.com/data',
          headers: { 'content-type': 'application/json' },
          body: { query: 'test' },
        },
        res: {
          status: 200,
          duration: 150,
          headers: { 'content-type': 'application/json' },
        },
      };

      const response = await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(networkLog),
      });

      expect(response.status).toBe(201);
      
      // Verify it was buffered correctly
      const buffer = getLogBuffer();
      const logs = buffer.getAll('default');
      const storedLog = logs.find(l => l.msg === 'browser network request');
      expect(storedLog).toBeDefined();
      expect(storedLog?.data).toHaveProperty('req');
      expect(storedLog?.data).toHaveProperty('res');
      expect((storedLog?.data as any).req.method).toBe('POST');
    });

    it('should default level to 30 if not provided', async () => {
      const app = createTestApp();

      const response = await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg: 'No level' }),
      });

      expect(response.status).toBe(201);
    });

    it('should generate time if not provided', async () => {
      const app = createTestApp();

      const response = await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 30, msg: 'No time' }),
      });

      expect(response.status).toBe(201);
    });

    it('should default msg to empty string if not provided', async () => {
      const app = createTestApp();

      const response = await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 30 }),
      });

      expect(response.status).toBe(201);
    });
  });

  describe('batch log ingestion', () => {
    it('should accept batch logs and return count', async () => {
      const app = createTestApp();
      const batch = createLogBatch(5);

      const response = await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: batch }),
      });

      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json.received).toBe(5);
    });

    it('should update channel logCount for batch', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();
      const batch = createLogBatch(10);

      await app.request('/api/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Channel': 'batch-test',
        },
        body: JSON.stringify({ logs: batch }),
      });

      const info = buffer.getChannelInfo('batch-test');
      expect(info?.logCount).toBe(10);
    });

    it('should handle empty batch', async () => {
      const app = createTestApp();
      const response = await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: [] }),
      });

      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json.received).toBe(0);
    });

    it('should handle large batch', async () => {
      const app = createTestApp();
      const batch = createLogBatch(150);

      const response = await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: batch }),
      });

      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json.received).toBe(150);
    });
  });

  describe('channel support', () => {
    it('should use X-Channel header', async () => {
      const app = createTestApp();

      const response = await app.request('/api/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Channel': 'my-app',
        },
        body: JSON.stringify(sampleLog),
      });

      const json = await response.json();
      expect(json.channel).toBe('my-app');
    });

    it('should use channel query parameter', async () => {
      const app = createTestApp();
      const response = await app.request('/api/logs?channel=my-app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleLog),
      });

      const json = await response.json();
      expect(json.channel).toBe('my-app');
    });

    it('should prefer header over query parameter', async () => {
      const app = createTestApp();
      const response = await app.request('/api/logs?channel=query-channel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Channel': 'header-channel',
        },
        body: JSON.stringify(sampleLog),
      });

      const json = await response.json();
      expect(json.channel).toBe('header-channel');
    });

    it('should default to "default" channel', async () => {
      const app = createTestApp();
      const response = await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleLog),
      });

      const json = await response.json();
      expect(json.channel).toBe('default');
    });

    it('should use channel for batch logs', async () => {
      const app = createTestApp();
      const batch = createLogBatch(3);

      const response = await app.request('/api/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Channel': 'batch-channel',
        },
        body: JSON.stringify({ logs: batch }),
      });

      const json = await response.json();
      expect(json.channel).toBe('batch-channel');
      expect(json.received).toBe(3);
    });
  });

  describe('source identity', () => {
    it('should stamp source/instanceId from headers on a single log', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();

      await app.request('/api/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Channel': 'identity-single',
          'X-Source': 'worker-1',
          'X-Instance-Id': 'host-a:42',
        },
        body: JSON.stringify({ level: 30, msg: 'with identity' }),
      });

      const stored = buffer.getAll('identity-single').find(l => l.msg === 'with identity');
      expect(stored?.source).toBe('worker-1');
      expect(stored?.instanceId).toBe('host-a:42');
      // No signing today — identity is always unverified.
      expect(stored?.sourceVerified).toBe(false);
    });

    it('should stamp identity on every log in a batch', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();
      const batch = createLogBatch(4);

      await app.request('/api/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Channel': 'identity-batch',
          'X-Source': 'api',
          'X-Instance-Id': 'host-b:7',
        },
        body: JSON.stringify({ logs: batch }),
      });

      const stored = buffer.getAll('identity-batch');
      expect(stored.length).toBe(4);
      expect(stored.every(l => l.source === 'api' && l.instanceId === 'host-b:7')).toBe(true);
    });

    it('should leave identity undefined when no headers are sent', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();

      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Channel': 'identity-none' },
        body: JSON.stringify({ level: 30, msg: 'no identity' }),
      });

      const stored = buffer.getAll('identity-none').find(l => l.msg === 'no identity');
      expect(stored?.source).toBeUndefined();
      expect(stored?.instanceId).toBeUndefined();
      expect(stored?.sourceVerified).toBe(false);
    });
  });

  describe('invalid bodies', () => {
    it.each(['0', '"text"', 'null', 'not json'])('should return 400 (not 500) for body %s', async (raw) => {
      const app = createTestApp();
      const response = await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: raw,
      });

      expect(response.status).toBe(400);
    });
  });
});
