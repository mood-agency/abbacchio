import { describe, it, expect } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';
import { collectSSEEvents, parseEventData } from '../helpers/sse-client.js';
import { getLogBuffer } from '../../src/lib/log-buffer.js';
import type { LogEntry } from '../../src/types.js';

describe('GET /api/logs/stream (SSE)', () => {
  describe('response headers', () => {
    it('should return SSE content type', async () => {
      const app = createTestApp();
      const response = await app.request('/api/logs/stream?channel=test');

      expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    });

    it('should return 200 status with channel', async () => {
      const app = createTestApp();
      const response = await app.request('/api/logs/stream?channel=test');

      expect(response.status).toBe(200);
    });

    it('should return 400 without channel parameter', async () => {
      const app = createTestApp();
      const response = await app.request('/api/logs/stream');

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('Channel parameter is required');
    });
  });

  describe('channels event', () => {
    it('should send channels event', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();
      buffer.add({ level: 30, msg: 'Test' }, 'app-1');

      const response = await app.request('/api/logs/stream?channel=app-1');
      const events = await collectSSEEvents(response, { maxEvents: 2, timeout: 1000 });

      const channelsEvent = events.find(e => e.event === 'channels');
      expect(channelsEvent).toBeDefined();
      expect(channelsEvent?.id).toBe('channels');

      const channels = parseEventData<string[]>(channelsEvent!);
      expect(channels).toContain('default');
      expect(channels).toContain('app-1');
    });

    it('should send channels event even with no logs for channel', async () => {
      const app = createTestApp();

      const response = await app.request('/api/logs/stream?channel=empty-channel');
      const events = await collectSSEEvents(response, { maxEvents: 2, timeout: 1000 });

      const channelsEvent = events.find(e => e.event === 'channels');
      expect(channelsEvent).toBeDefined();

      const channels = parseEventData<string[]>(channelsEvent!);
      expect(channels).toContain('default');
    });
  });

  describe('event structure', () => {
    it('should send channels event with correct format', async () => {
      const app = createTestApp();

      const response = await app.request('/api/logs/stream?channel=test');
      const events = await collectSSEEvents(response, { maxEvents: 2, timeout: 1000 });

      const channelsEvent = events.find(e => e.event === 'channels');
      expect(channelsEvent?.event).toBe('channels');
      expect(channelsEvent?.id).toBe('channels');
      expect(() => JSON.parse(channelsEvent!.data)).not.toThrow();
    });
  });

  describe('no initial batch (no storage)', () => {
    it('should not send initial batch event since logs are not stored', async () => {
      const app = createTestApp();
      const buffer = getLogBuffer();

      // These are emitted but not stored
      buffer.add({ level: 30, msg: 'Log 1' }, 'test');
      buffer.add({ level: 40, msg: 'Log 2' }, 'test');

      const response = await app.request('/api/logs/stream?channel=test');
      const events = await collectSSEEvents(response, { maxEvents: 2, timeout: 1000 });

      // Should only get channels event, no batch since we don't store
      const batchEvent = events.find(e => e.event === 'batch');
      expect(batchEvent).toBeUndefined();

      const channelsEvent = events.find(e => e.event === 'channels');
      expect(channelsEvent).toBeDefined();
    });
  });
});
