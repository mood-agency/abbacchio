import { describe, it, expect, vi } from 'vitest';
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

    it('should emit log event when log is ingested', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();
      const callback = vi.fn();
      buffer.on('log', callback);

      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 30, msg: 'Stored log' }),
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].msg).toBe('Stored log');
    });

    it('should normalize Winston-style logs', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();
      const callback = vi.fn();
      buffer.on('log', callback);

      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(winstonStyleLog),
      });

      expect(callback.mock.calls[0][0].msg).toBe('Winston style message');
      expect(callback.mock.calls[0][0].namespace).toBe('winston-logger');
    });

    it('should assign correct levelLabel for each log level', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();
      const callback = vi.fn();
      buffer.on('log', callback);

      for (const [label, log] of Object.entries(sampleLogs)) {
        await app.request('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(log),
        });
      }

      const logs = callback.mock.calls.map(c => c[0]);
      expect(logs.find(l => l.level === 10)?.levelLabel).toBe('trace');
      expect(logs.find(l => l.level === 20)?.levelLabel).toBe('debug');
      expect(logs.find(l => l.level === 30)?.levelLabel).toBe('info');
      expect(logs.find(l => l.level === 40)?.levelLabel).toBe('warn');
      expect(logs.find(l => l.level === 50)?.levelLabel).toBe('error');
      expect(logs.find(l => l.level === 60)?.levelLabel).toBe('fatal');
    });

    it('should include extra fields in data object', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();
      const callback = vi.fn();
      buffer.on('log', callback);

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

      const emittedLog = callback.mock.calls[0][0];
      expect(emittedLog.data.userId).toBe(123);
      expect(emittedLog.data.requestId).toBe('abc-123');
      expect(emittedLog.data.metadata).toEqual({ key: 'value' });
    });

    it('should default level to 30 if not provided', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();
      const callback = vi.fn();
      buffer.on('log', callback);

      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg: 'No level' }),
      });

      const emittedLog = callback.mock.calls[0][0];
      expect(emittedLog.level).toBe(30);
      expect(emittedLog.levelLabel).toBe('info');
    });

    it('should generate time if not provided', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();
      const callback = vi.fn();
      buffer.on('log', callback);
      const before = Date.now();

      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 30, msg: 'No time' }),
      });

      const after = Date.now();
      const emittedLog = callback.mock.calls[0][0];
      expect(emittedLog.time).toBeGreaterThanOrEqual(before);
      expect(emittedLog.time).toBeLessThanOrEqual(after);
    });

    it('should default msg to empty string if not provided', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();
      const callback = vi.fn();
      buffer.on('log', callback);

      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 30 }),
      });

      const emittedLog = callback.mock.calls[0][0];
      expect(emittedLog.msg).toBe('');
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

    it('should emit batch event with all logs', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();
      const callback = vi.fn();
      buffer.on('batch', callback);

      const batch = createLogBatch(10);

      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: batch }),
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0]).toHaveLength(10);
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
      const buffer = getLogBuffer();
      const callback = vi.fn();
      buffer.on('log', callback);

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
      expect(callback.mock.calls[0][0].channel).toBe('my-app');
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
      const buffer = getLogBuffer();
      const callback = vi.fn();
      buffer.on('batch', callback);

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

      const emittedLogs = callback.mock.calls[0][0];
      expect(emittedLogs).toHaveLength(3);
      expect(emittedLogs.every((l: any) => l.channel === 'batch-channel')).toBe(true);
    });
  });

  describe('encrypted logs', () => {
    it('should emit encrypted log with encrypted flag', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();
      const callback = vi.fn();
      buffer.on('log', callback);

      const encryptedLog = createEncryptedLog('base64encrypteddata');

      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(encryptedLog),
      });

      const emittedLog = callback.mock.calls[0][0];
      expect(emittedLog.encrypted).toBe(true);
      expect(emittedLog.encryptedData).toBe('base64encrypteddata');
      expect(emittedLog.msg).toBe('[Encrypted]');
    });

    it('should handle encrypted log in batch', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();
      const callback = vi.fn();
      buffer.on('batch', callback);

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

      const emittedLogs = callback.mock.calls[0][0];
      expect(emittedLogs[0].encrypted).toBeUndefined();
      expect(emittedLogs[1].encrypted).toBe(true);
      expect(emittedLogs[2].encrypted).toBe(true);
    });
  });
});
