import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  createValidatorMiddleware,
  validateBatch,
  validateLogEntry,
  getDefaultValidatorConfig,
  getValidatedBody,
} from '../../src/middleware/validator.js';

describe('validateLogEntry', () => {
  it('should validate valid log entry', () => {
    const result = validateLogEntry({ level: 30, msg: 'test' }, 1000);
    expect(result.valid).toBe(true);
  });

  it('should reject oversized log entry', () => {
    const largeLog = { msg: 'x'.repeat(2000) };
    const result = validateLogEntry(largeLog, 1000);

    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(413);
  });
});

describe('validateBatch', () => {
  const config = {
    maxPayloadSize: 10000,
    maxBatchSize: 5,
    maxSingleLogSize: 500,
  };

  it('should validate valid batch', () => {
    const result = validateBatch(
      [{ level: 30, msg: 'test1' }, { level: 30, msg: 'test2' }],
      config
    );
    expect(result.valid).toBe(true);
  });

  it('should reject non-array input', () => {
    const result = validateBatch('not an array' as any, config);
    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  it('should reject oversized batch', () => {
    const logs = Array(10).fill({ level: 30, msg: 'test' });
    const result = validateBatch(logs, config);

    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(413);
    expect(result.error).toContain('Batch size exceeds');
  });

  it('should reject batch with oversized entry', () => {
    const logs = [
      { level: 30, msg: 'normal' },
      { level: 30, msg: 'x'.repeat(1000) },
    ];
    const result = validateBatch(logs, config);

    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(413);
    expect(result.error).toContain('index 1');
  });
});

describe('validator middleware', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.use(
      '/api/logs',
      createValidatorMiddleware({
        maxPayloadSize: 1000,
        maxBatchSize: 5,
        maxSingleLogSize: 200,
      })
    );
    app.post('/api/logs', (c) => {
      const body = getValidatedBody(c);
      return c.json({ received: true, body });
    });
    app.get('/api/other', (c) => c.json({ ok: true }));
  });

  it('should pass valid single log', async () => {
    const res = await app.request('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 30, msg: 'test' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  });

  it('should pass valid batch', async () => {
    const res = await app.request('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        logs: [{ level: 30, msg: 'test1' }, { level: 30, msg: 'test2' }],
      }),
    });

    expect(res.status).toBe(200);
  });

  it('should reject invalid JSON', async () => {
    const res = await app.request('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON');
  });

  it('should reject oversized payload', async () => {
    const res = await app.request('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg: 'x'.repeat(2000) }),
    });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe('Payload Too Large');
  });

  it('should reject oversized batch', async () => {
    const res = await app.request('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        logs: Array(10).fill({ level: 30, msg: 'test' }),
      }),
    });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.message).toContain('Batch size exceeds');
  });

  it('should skip validation for non-POST requests', async () => {
    const res = await app.request('/api/other');
    expect(res.status).toBe(200);
  });

  it('should store validated body in context', async () => {
    const res = await app.request('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 30, msg: 'test' }),
    });

    const body = await res.json();
    expect(body.body).toEqual({ level: 30, msg: 'test' });
  });
});

describe('getDefaultValidatorConfig', () => {
  it('should return default config', () => {
    const config = getDefaultValidatorConfig();

    expect(config.maxPayloadSize).toBe(1048576); // 1MB
    expect(config.maxBatchSize).toBe(1000);
    expect(config.maxSingleLogSize).toBe(65536); // 64KB
  });
});
