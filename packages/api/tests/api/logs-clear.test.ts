import { describe, it, expect, vi } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';
import { getLogBuffer, DEFAULT_CHANNEL } from '../../src/lib/log-buffer.js';

describe('DELETE /api/logs', () => {
  it('should succeed and return success response', async () => {
    const app = createTestApp();

    const response = await app.request('/api/logs', { method: 'DELETE' });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ success: true, channel: 'all' });
  });

  it('should succeed when clearing specific channel', async () => {
    const app = createTestApp();

    const response = await app.request('/api/logs?channel=app-1', { method: 'DELETE' });

    const json = await response.json();
    expect(json).toEqual({ success: true, channel: 'app-1' });
  });

  it('should emit clear event', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();
    const callback = vi.fn();
    buffer.on('clear', callback);

    await app.request('/api/logs', { method: 'DELETE' });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should reset channels to default when clearing all', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    // Register some channels
    buffer.add({ level: 30, msg: 'Test' }, 'app-1');
    buffer.add({ level: 30, msg: 'Test' }, 'app-2');
    expect(buffer.getChannels()).toContain('app-1');
    expect(buffer.getChannels()).toContain('app-2');

    await app.request('/api/logs', { method: 'DELETE' });

    expect(buffer.getChannels()).toEqual([DEFAULT_CHANNEL]);
  });

  it('should preserve channel registration when clearing specific channel', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    buffer.add({ level: 30, msg: 'Test' }, 'app-1');
    buffer.add({ level: 30, msg: 'Test' }, 'app-2');

    await app.request('/api/logs?channel=app-1', { method: 'DELETE' });

    // Channel registration persists
    expect(buffer.getChannels()).toContain('app-2');
  });
});
