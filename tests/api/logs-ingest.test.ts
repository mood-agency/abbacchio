import { describe, it, expect } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';
import { sampleLog, sampleLogs, winstonStyleLog, createLogBatch, createEncryptedLog, createLogWithExtras } from '../helpers/fixtures.js';
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

    it('should store the log in buffer', async () => {
      const app = createTestApp();
      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 30, msg: 'Stored log' }),
      });

      const buffer = getLogBuffer();
      const logs = buffer.getAll();
      expect(logs).toHaveLength(1);
      expect(logs[0].msg).toBe('Stored log');
    });

    it('should normalize Winston-style logs', async () => {
      const app = createTestApp();
      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(winstonStyleLog),
      });

      const buffer = getLogBuffer();
      const logs = buffer.getAll();
      expect(logs[0].msg).toBe('Winston style message');
      expect(logs[0].namespace).toBe('winston-logger');
    });

    it('should assign correct levelLabel for each log level', async () => {
      const app = createTestApp();

      for (const [label, log] of Object.entries(sampleLogs)) {
        await app.request('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(log),
        });
      }

      const buffer = getLogBuffer();
      const logs = buffer.getAll();

      expect(logs.find(l => l.level === 10)?.levelLabel).toBe('trace');
      expect(logs.find(l => l.level === 20)?.levelLabel).toBe('debug');
      expect(logs.find(l => l.level === 30)?.levelLabel).toBe('info');
      expect(logs.find(l => l.level === 40)?.levelLabel).toBe('warn');
      expect(logs.find(l => l.level === 50)?.levelLabel).toBe('error');
      expect(logs.find(l => l.level === 60)?.levelLabel).toBe('fatal');
    });

    it('should store extra fields in data object', async () => {
      const app = createTestApp();
      const logWithExtras = createLogWithExtras({
        userId: 123,
        requestId: 'abc-123',
        metadata: { key: 'value' },
      });

      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logWithExtras),
      });

      const buffer = getLogBuffer();
      const logs = buffer.getAll();
      expect(logs[0].data.userId).toBe(123);
      expect(logs[0].data.requestId).toBe('abc-123');
      expect(logs[0].data.metadata).toEqual({ key: 'value' });
    });

    it('should default level to 30 if not provided', async () => {
      const app = createTestApp();
      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg: 'No level' }),
      });

      const buffer = getLogBuffer();
      const logs = buffer.getAll();
      expect(logs[0].level).toBe(30);
      expect(logs[0].levelLabel).toBe('info');
    });

    it('should generate time if not provided', async () => {
      const app = createTestApp();
      const before = Date.now();

      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 30, msg: 'No time' }),
      });

      const after = Date.now();
      const buffer = getLogBuffer();
      const logs = buffer.getAll();

      expect(logs[0].time).toBeGreaterThanOrEqual(before);
      expect(logs[0].time).toBeLessThanOrEqual(after);
    });

    it('should default msg to empty string if not provided', async () => {
      const app = createTestApp();
      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 30 }),
      });

      const buffer = getLogBuffer();
      const logs = buffer.getAll();
      expect(logs[0].msg).toBe('');
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

    it('should store all batch logs in buffer', async () => {
      const app = createTestApp();
      const batch = createLogBatch(10);

      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: batch }),
      });

      const buffer = getLogBuffer();
      expect(buffer.size).toBe(10);
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
      const app = createTestApp({ bufferSize: 200 });
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

      const buffer = getLogBuffer();
      const logs = buffer.getAll();
      expect(logs[0].channel).toBe('my-app');
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

      const buffer = getLogBuffer();
      const logs = buffer.getAll('batch-channel');
      expect(logs).toHaveLength(3);
    });
  });

  describe('encrypted logs', () => {
    it('should store encrypted log with encrypted flag', async () => {
      const app = createTestApp();
      const encryptedLog = createEncryptedLog('base64encrypteddata');

      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(encryptedLog),
      });

      const buffer = getLogBuffer();
      const logs = buffer.getAll();
      expect(logs[0].encrypted).toBe(true);
      expect(logs[0].encryptedData).toBe('base64encrypteddata');
      expect(logs[0].msg).toBe('[Encrypted]');
    });

    it('should handle encrypted log in batch', async () => {
      const app = createTestApp();
      const batch = [
        { level: 30, msg: 'Plain log' },
        { encrypted: 'encrypted1' },
        { encrypted: 'encrypted2' },
      ];

      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: batch }),
      });

      const buffer = getLogBuffer();
      const logs = buffer.getAll();
      expect(logs[0].encrypted).toBeUndefined();
      expect(logs[1].encrypted).toBe(true);
      expect(logs[2].encrypted).toBe(true);
    });
  });
});
