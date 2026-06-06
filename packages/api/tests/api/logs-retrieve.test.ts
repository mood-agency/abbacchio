import { describe, it, expect } from 'bun:test';
import { createTestApp } from '../helpers/test-app.js';

describe('GET /api/logs', () => {
  it('should return empty logs when none ingested for a channel', async () => {
    const app = createTestApp();
    const ch = `empty-${Date.now()}`;
    const response = await app.request(`/api/logs?channel=${ch}`);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.logs).toEqual([]);
    expect(json.count).toBe(0);
    expect(json.total).toBe(0);
    expect(json.channel).toBe(ch);
  });

  it('should return logs after ingestion', async () => {
    const app = createTestApp();
    const ch = `ingest-${Date.now()}`;

    await app.request('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Channel': ch },
      body: JSON.stringify({ level: 30, msg: 'Ingested log' }),
    });

    const response = await app.request(`/api/logs?channel=${ch}`);
    const json = await response.json();

    expect(json.count).toBe(1);
    expect(json.total).toBe(1);
    expect(json.logs).toHaveLength(1);
    expect(json.logs[0].msg).toBe('Ingested log');
  });

  it('should return newest logs on initial load in chronological order', async () => {
    const app = createTestApp();
    const ch = `newest-${Date.now()}`;

    for (let i = 1; i <= 5; i++) {
      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Channel': ch },
        body: JSON.stringify({ level: 30, msg: `Log ${i}` }),
      });
    }

    const response = await app.request(`/api/logs?channel=${ch}&limit=3`);
    const json = await response.json();

    // Should return newest 3 logs in chronological order (oldest-to-newest)
    expect(json.count).toBe(3);
    expect(json.total).toBe(5);
    expect(json.logs[0].msg).toBe('Log 3');
    expect(json.logs[1].msg).toBe('Log 4');
    expect(json.logs[2].msg).toBe('Log 5');
  });

  it('should support afterId for incremental polling', async () => {
    const app = createTestApp();
    const ch = `afterid-${Date.now()}`;

    await app.request('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Channel': ch },
      body: JSON.stringify({ level: 30, msg: 'First log' }),
    });
    await app.request('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Channel': ch },
      body: JSON.stringify({ level: 30, msg: 'Second log' }),
    });

    const allResponse = await app.request(`/api/logs?channel=${ch}`);
    const allJson = await allResponse.json();
    const firstId = allJson.logs[0].id;

    const response = await app.request(`/api/logs?channel=${ch}&afterId=${firstId}`);
    const json = await response.json();

    expect(json.count).toBe(1);
    expect(json.logs[0].msg).toBe('Second log');
  });

  it('should support beforeId for backward pagination', async () => {
    const app = createTestApp();
    const ch = `beforeid-${Date.now()}`;

    for (let i = 1; i <= 5; i++) {
      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Channel': ch },
        body: JSON.stringify({ level: 30, msg: `Log ${i}` }),
      });
    }

    const allResp = await app.request(`/api/logs?channel=${ch}`);
    const allJson = await allResp.json();

    // Use the 3rd log's ID as beforeId — should return logs 1 and 2
    const thirdId = allJson.logs[2].id;
    const resp = await app.request(`/api/logs?channel=${ch}&beforeId=${thirdId}`);
    const json = await resp.json();

    expect(json.count).toBe(2);
    expect(json.logs[0].msg).toBe('Log 1');
    expect(json.logs[1].msg).toBe('Log 2');
    expect(json.hasMore).toBe(false);
  });

  it('should include hasMore flag in beforeId response', async () => {
    const app = createTestApp();
    const ch = `hasmore-${Date.now()}`;

    for (let i = 1; i <= 5; i++) {
      await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Channel': ch },
        body: JSON.stringify({ level: 30, msg: `Log ${i}` }),
      });
    }

    const allResp = await app.request(`/api/logs?channel=${ch}`);
    const allJson = await allResp.json();
    const lastId = allJson.logs[allJson.logs.length - 1].id;

    // beforeId with limit=2 on last log — should return 2 logs and hasMore=true
    const resp = await app.request(`/api/logs?channel=${ch}&beforeId=${lastId}&limit=2`);
    const json = await resp.json();

    expect(json.count).toBe(2);
    expect(json.hasMore).toBe(true);
  });

  it('should return empty array for non-existent channel', async () => {
    const app = createTestApp();
    const ch = `nonexistent-${Date.now()}`;

    const response = await app.request(`/api/logs?channel=${ch}`);
    const json = await response.json();

    expect(json.count).toBe(0);
    expect(json.logs).toEqual([]);
    expect(json.channel).toBe(ch);
  });

  it('should support FTS5 search on msg field', async () => {
    const app = createTestApp();
    const ch = `fts-msg-${Date.now()}`;

    await app.request('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Channel': ch },
      body: JSON.stringify({ logs: [
        { level: 30, msg: 'User authentication successful' },
        { level: 50, msg: 'Database connection failed' },
        { level: 30, msg: 'Payment processed for order 123' },
      ] }),
    });

    const resp = await app.request(`/api/logs?channel=${ch}&search=authentication`);
    const json = await resp.json();

    expect(json.count).toBe(1);
    expect(json.logs[0].msg).toBe('User authentication successful');
  });

  it('should support FTS5 search on data field', async () => {
    const app = createTestApp();
    const ch = `fts-data-${Date.now()}`;

    await app.request('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Channel': ch },
      body: JSON.stringify({ logs: [
        { level: 30, msg: 'Request', userId: 'alice' },
        { level: 30, msg: 'Request', userId: 'bob' },
      ] }),
    });

    const resp = await app.request(`/api/logs?channel=${ch}&search=alice`);
    const json = await resp.json();

    expect(json.count).toBe(1);
    expect(json.logs[0].data.userId).toBe('alice');
  });

  it('should support multi-word FTS5 search (AND)', async () => {
    const app = createTestApp();
    const ch = `fts-multi-${Date.now()}`;

    await app.request('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Channel': ch },
      body: JSON.stringify({ logs: [
        { level: 30, msg: 'User login successful' },
        { level: 30, msg: 'User logout completed' },
        { level: 30, msg: 'System login attempt' },
      ] }),
    });

    const resp = await app.request(`/api/logs?channel=${ch}&search=user login`);
    const json = await resp.json();

    expect(json.count).toBe(1);
    expect(json.logs[0].msg).toBe('User login successful');
  });

  it('should support FTS5 prefix matching', async () => {
    const app = createTestApp();
    const ch = `fts-prefix-${Date.now()}`;

    await app.request('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Channel': ch },
      body: JSON.stringify({ logs: [
        { level: 30, msg: 'authentication started' },
        { level: 30, msg: 'authorized access' },
        { level: 30, msg: 'payment processed' },
      ] }),
    });

    const resp = await app.request(`/api/logs?channel=${ch}&search=auth`);
    const json = await resp.json();

    expect(json.count).toBe(2);
  });
});
