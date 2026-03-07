import { describe, it, expect } from 'bun:test';
import { createTestApp } from '../helpers/test-app.js';

describe('GET /api/logs', () => {
  it('should return empty logs when none ingested', async () => {
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

  it('should return logs after ingestion', async () => {
    const app = createTestApp();

    // Ingest a log
    await app.request('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 30, msg: 'Ingested log' }),
    });

    // Retrieve logs
    const response = await app.request('/api/logs');
    const json = await response.json();

    expect(json.count).toBe(1);
    expect(json.logs).toHaveLength(1);
    expect(json.logs[0].msg).toBe('Ingested log');
  });

  it('should support afterId for incremental polling', async () => {
    const app = createTestApp();

    // Ingest two logs
    await app.request('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 30, msg: 'First log' }),
    });
    await app.request('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 30, msg: 'Second log' }),
    });

    // Get all logs to find the first ID
    const allResponse = await app.request('/api/logs');
    const allJson = await allResponse.json();
    const firstId = allJson.logs[0].id;

    // Get logs after the first ID
    const response = await app.request(`/api/logs?afterId=${firstId}`);
    const json = await response.json();

    expect(json.count).toBe(1);
    expect(json.logs[0].msg).toBe('Second log');
  });

  it('should return empty array for non-existent channel', async () => {
    const app = createTestApp();

    const response = await app.request('/api/logs?channel=any-channel');

    const json = await response.json();
    expect(json.count).toBe(0);
    expect(json.logs).toEqual([]);
    expect(json.channel).toBe('any-channel');
  });
});
