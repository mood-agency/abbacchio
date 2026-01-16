import { describe, it, expect } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';
import { collectSSEEvents, parseEventData } from '../helpers/sse-client.js';
import { getLogBuffer } from '../../src/lib/log-buffer.js';
import type { LogEntry } from '../../src/types.js';

describe('GET /api/logs/stream (SSE)', () => {
  describe('response headers', () => {
    it('should return SSE content type', async () => {
      const app = createTestApp();
      const response = await app.request('/api/logs/stream');

      expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    });

    it('should return 200 status', async () => {
      const app = createTestApp();
      const response = await app.request('/api/logs/stream');

      expect(response.status).toBe(200);
    });
  });

  describe('initial batch', () => {
    it('should send initial batch of existing logs', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();

      buffer.add({ level: 30, msg: 'Log 1' });
      buffer.add({ level: 40, msg: 'Log 2' });

      const response = await app.request('/api/logs/stream');
      const events = await collectSSEEvents(response, { maxEvents: 2, timeout: 1000 });

      const batchEvent = events.find(e => e.event === 'batch');
      expect(batchEvent).toBeDefined();
      expect(batchEvent?.id).toBe('initial');

      const logs = parseEventData<LogEntry[]>(batchEvent!);
      expect(logs).toHaveLength(2);
      expect(logs[0].msg).toBe('Log 1');
      expect(logs[1].msg).toBe('Log 2');
    });

    it('should not send batch event if buffer is empty', async () => {
      const app = createTestApp();

      const response = await app.request('/api/logs/stream');
      const events = await collectSSEEvents(response, { maxEvents: 2, timeout: 1000 });

      const batchEvent = events.find(e => e.event === 'batch');
      expect(batchEvent).toBeUndefined();
    });
  });

  describe('channels event', () => {
    it('should send channels event after initial batch', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();
      buffer.add({ level: 30, msg: 'Test' }, 'app-1');

      const response = await app.request('/api/logs/stream');
      const events = await collectSSEEvents(response, { maxEvents: 3, timeout: 1000 });

      const channelsEvent = events.find(e => e.event === 'channels');
      expect(channelsEvent).toBeDefined();
      expect(channelsEvent?.id).toBe('channels');

      const channels = parseEventData<string[]>(channelsEvent!);
      expect(channels).toContain('default');
      expect(channels).toContain('app-1');
    });

    it('should send channels event even with empty buffer', async () => {
      const app = createTestApp();

      const response = await app.request('/api/logs/stream');
      const events = await collectSSEEvents(response, { maxEvents: 2, timeout: 1000 });

      const channelsEvent = events.find(e => e.event === 'channels');
      expect(channelsEvent).toBeDefined();

      const channels = parseEventData<string[]>(channelsEvent!);
      expect(channels).toContain('default');
    });
  });

  describe('channel filtering', () => {
    it('should filter initial batch by channel', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();

      buffer.add({ level: 30, msg: 'App 1 log' }, 'app-1');
      buffer.add({ level: 30, msg: 'App 2 log' }, 'app-2');
      buffer.add({ level: 30, msg: 'App 1 log 2' }, 'app-1');

      const response = await app.request('/api/logs/stream?channel=app-1');
      const events = await collectSSEEvents(response, { maxEvents: 2, timeout: 1000 });

      const batchEvent = events.find(e => e.event === 'batch');
      const logs = parseEventData<LogEntry[]>(batchEvent!);

      expect(logs).toHaveLength(2);
      expect(logs.every(l => l.channel === 'app-1')).toBe(true);
    });

    it('should not send batch if channel has no logs', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();

      buffer.add({ level: 30, msg: 'Other channel' }, 'other');

      const response = await app.request('/api/logs/stream?channel=empty-channel');
      const events = await collectSSEEvents(response, { maxEvents: 2, timeout: 1000 });

      const batchEvent = events.find(e => e.event === 'batch');
      expect(batchEvent).toBeUndefined();
    });
  });

  describe('event structure', () => {
    it('should send batch event with correct format', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();
      buffer.add({ level: 30, msg: 'Test' });

      const response = await app.request('/api/logs/stream');
      const events = await collectSSEEvents(response, { maxEvents: 2, timeout: 1000 });

      const batchEvent = events.find(e => e.event === 'batch');
      expect(batchEvent?.event).toBe('batch');
      expect(batchEvent?.id).toBe('initial');
      expect(() => JSON.parse(batchEvent!.data)).not.toThrow();
    });

    it('should send channels event with correct format', async () => {
      const app = createTestApp();

      const response = await app.request('/api/logs/stream');
      const events = await collectSSEEvents(response, { maxEvents: 2, timeout: 1000 });

      const channelsEvent = events.find(e => e.event === 'channels');
      expect(channelsEvent?.event).toBe('channels');
      expect(channelsEvent?.id).toBe('channels');
      expect(() => JSON.parse(channelsEvent!.data)).not.toThrow();
    });
  });

  describe('log entry structure in SSE', () => {
    it('should include all required fields in streamed logs', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();

      buffer.add({
        level: 50,
        time: 1234567890,
        msg: 'Error log',
        namespace: 'test-ns',
        extra: 'data',
      });

      const response = await app.request('/api/logs/stream');
      const events = await collectSSEEvents(response, { maxEvents: 2, timeout: 1000 });

      const batchEvent = events.find(e => e.event === 'batch');
      const logs = parseEventData<LogEntry[]>(batchEvent!);

      expect(logs[0]).toMatchObject({
        level: 50,
        levelLabel: 'error',
        time: 1234567890,
        msg: 'Error log',
        namespace: 'test-ns',
        channel: 'default',
      });
      expect(logs[0].id).toBeDefined();
      expect(logs[0].data.extra).toBe('data');
    });

    it('should include encrypted log fields', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();

      buffer.add({ encrypted: 'encryptedpayload' });

      const response = await app.request('/api/logs/stream');
      const events = await collectSSEEvents(response, { maxEvents: 2, timeout: 1000 });

      const batchEvent = events.find(e => e.event === 'batch');
      const logs = parseEventData<LogEntry[]>(batchEvent!);

      expect(logs[0].encrypted).toBe(true);
      expect(logs[0].encryptedData).toBe('encryptedpayload');
      expect(logs[0].msg).toBe('[Encrypted]');
    });
  });
});
