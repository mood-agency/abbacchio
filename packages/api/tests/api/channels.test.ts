import { describe, it, expect } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';
import { getLogBuffer, DEFAULT_CHANNEL } from '../../src/lib/log-buffer.js';

describe('GET /api/channels', () => {
  it('should return default channel initially', async () => {
    const app = createTestApp();

    const response = await app.request('/api/channels');

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.channels).toEqual([DEFAULT_CHANNEL]);
  });

  it('should return all registered channels', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    buffer.add({ level: 30, msg: 'Test' }, 'web-app');
    buffer.add({ level: 30, msg: 'Test' }, 'api-server');
    buffer.add({ level: 30, msg: 'Test' }, 'worker');

    const response = await app.request('/api/channels');
    const json = await response.json();

    expect(json.channels).toContain(DEFAULT_CHANNEL);
    expect(json.channels).toContain('web-app');
    expect(json.channels).toContain('api-server');
    expect(json.channels).toContain('worker');
    expect(json.channels).toHaveLength(4);
  });

  it('should reflect channels added via API ingestion', async () => {
    const app = createTestApp();

    // Ingest logs with different channels
    await app.request('/api/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Channel': 'channel-1',
      },
      body: JSON.stringify({ level: 30, msg: 'Test' }),
    });

    await app.request('/api/logs?channel=channel-2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 30, msg: 'Test' }),
    });

    const response = await app.request('/api/channels');
    const json = await response.json();

    expect(json.channels).toContain('channel-1');
    expect(json.channels).toContain('channel-2');
  });

  it('should not duplicate channels', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    buffer.add({ level: 30, msg: 'Log 1' }, 'my-app');
    buffer.add({ level: 30, msg: 'Log 2' }, 'my-app');
    buffer.add({ level: 30, msg: 'Log 3' }, 'my-app');

    const response = await app.request('/api/channels');
    const json = await response.json();

    const myAppCount = json.channels.filter((c: string) => c === 'my-app').length;
    expect(myAppCount).toBe(1);
  });

  it('should reset to default after clearing all logs', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    buffer.add({ level: 30, msg: 'Test' }, 'app-1');
    buffer.add({ level: 30, msg: 'Test' }, 'app-2');

    await app.request('/api/logs', { method: 'DELETE' });

    const response = await app.request('/api/channels');
    const json = await response.json();

    expect(json.channels).toEqual([DEFAULT_CHANNEL]);
  });
});
