import { describe, it, expect } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';

describe('GET /api/logs', () => {
  it('should return empty logs (no storage architecture)', async () => {
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

  it('should return empty logs even after ingestion (streaming-only)', async () => {
    const app = createTestApp();

    // Ingest some logs
    await app.request('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 30, msg: 'Ingested log' }),
    });

    // Retrieve logs - should be empty since we don't store
    const response = await app.request('/api/logs');
    const json = await response.json();

    expect(json.count).toBe(0);
    expect(json.logs).toEqual([]);
  });

  it('should return empty array for any channel', async () => {
    const app = createTestApp();

    const response = await app.request('/api/logs?channel=any-channel');

    const json = await response.json();
    expect(json.count).toBe(0);
    expect(json.logs).toEqual([]);
    expect(json.channel).toBe('any-channel');
  });
});
