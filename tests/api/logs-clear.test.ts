import { describe, it, expect } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';
import { getLogBuffer, DEFAULT_CHANNEL } from '../../src/lib/log-buffer.js';

describe('DELETE /api/logs', () => {
  it('should clear all logs', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    buffer.add({ level: 30, msg: 'Log 1' }, 'app-1');
    buffer.add({ level: 30, msg: 'Log 2' }, 'app-2');
    expect(buffer.size).toBe(2);

    const response = await app.request('/api/logs', { method: 'DELETE' });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ success: true, channel: 'all' });
    expect(buffer.size).toBe(0);
  });

  it('should clear only specified channel', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    buffer.add({ level: 30, msg: 'App 1 log 1' }, 'app-1');
    buffer.add({ level: 30, msg: 'App 1 log 2' }, 'app-1');
    buffer.add({ level: 30, msg: 'App 2 log' }, 'app-2');

    const response = await app.request('/api/logs?channel=app-1', { method: 'DELETE' });

    const json = await response.json();
    expect(json).toEqual({ success: true, channel: 'app-1' });

    expect(buffer.getAll('app-1')).toHaveLength(0);
    expect(buffer.getAll('app-2')).toHaveLength(1);
  });

  it('should succeed when clearing empty buffer', async () => {
    const app = createTestApp();

    const response = await app.request('/api/logs', { method: 'DELETE' });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  it('should succeed when clearing non-existent channel', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    buffer.add({ level: 30, msg: 'Test' }, 'existing');

    const response = await app.request('/api/logs?channel=non-existent', { method: 'DELETE' });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ success: true, channel: 'non-existent' });

    // Existing logs should remain
    expect(buffer.size).toBe(1);
  });

  it('should reset channels to default when clearing all', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    buffer.add({ level: 30, msg: 'Test' }, 'app-1');
    buffer.add({ level: 30, msg: 'Test' }, 'app-2');
    expect(buffer.getChannels()).toContain('app-1');
    expect(buffer.getChannels()).toContain('app-2');

    await app.request('/api/logs', { method: 'DELETE' });

    expect(buffer.getChannels()).toEqual([DEFAULT_CHANNEL]);
  });

  it('should preserve other channels when clearing one', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    buffer.add({ level: 30, msg: 'Test' }, 'app-1');
    buffer.add({ level: 30, msg: 'Test' }, 'app-2');

    await app.request('/api/logs?channel=app-1', { method: 'DELETE' });

    // Note: Channel registration persists even after logs are cleared
    expect(buffer.getChannels()).toContain('app-2');
  });

  it('should be verifiable via GET /api/logs', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    buffer.add({ level: 30, msg: 'Log 1' });
    buffer.add({ level: 30, msg: 'Log 2' });

    await app.request('/api/logs', { method: 'DELETE' });

    const response = await app.request('/api/logs');
    const json = await response.json();

    expect(json.count).toBe(0);
    expect(json.logs).toEqual([]);
  });
});
