import { describe, it, expect } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';
import { getLogBuffer } from '../../src/lib/log-buffer.js';

describe('GET /api/logs', () => {
  it('should return empty logs from empty buffer', async () => {
    const app = createTestApp();
    const response = await app.request('/api/logs');

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({
      logs: [],
      count: 0,
      channel: 'all',
    });
  });

  it('should return all logs from buffer', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    buffer.add({ level: 30, msg: 'Log 1' });
    buffer.add({ level: 40, msg: 'Log 2' });

    const response = await app.request('/api/logs');

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.count).toBe(2);
    expect(json.logs).toHaveLength(2);
    expect(json.channel).toBe('all');
  });

  it('should filter logs by channel', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    buffer.add({ level: 30, msg: 'App 1 log 1' }, 'app-1');
    buffer.add({ level: 30, msg: 'App 2 log' }, 'app-2');
    buffer.add({ level: 30, msg: 'App 1 log 2' }, 'app-1');

    const response = await app.request('/api/logs?channel=app-1');

    const json = await response.json();
    expect(json.count).toBe(2);
    expect(json.channel).toBe('app-1');
    expect(json.logs.every((l: any) => l.channel === 'app-1')).toBe(true);
  });

  it('should return empty array for non-existent channel', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    buffer.add({ level: 30, msg: 'Test' }, 'existing-channel');

    const response = await app.request('/api/logs?channel=non-existent');

    const json = await response.json();
    expect(json.count).toBe(0);
    expect(json.logs).toEqual([]);
    expect(json.channel).toBe('non-existent');
  });

  it('should return logs with correct structure', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    buffer.add({
      level: 50,
      time: 1234567890,
      msg: 'Error occurred',
      namespace: 'test-ns',
      customField: 'value',
    });

    const response = await app.request('/api/logs');
    const json = await response.json();

    expect(json.logs[0]).toMatchObject({
      level: 50,
      levelLabel: 'error',
      time: 1234567890,
      msg: 'Error occurred',
      namespace: 'test-ns',
      channel: 'default',
      data: { customField: 'value' },
    });
    expect(json.logs[0].id).toBeDefined();
  });

  it('should return logs after ingestion via API', async () => {
    const app = createTestApp();

    // Ingest some logs
    await app.request('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 30, msg: 'Ingested log' }),
    });

    // Retrieve logs
    const response = await app.request('/api/logs');
    const json = await response.json();

    expect(json.count).toBe(1);
    expect(json.logs[0].msg).toBe('Ingested log');
  });
});
