import { describe, it, expect } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';

const API_KEY = 'test-secret-key';

describe('Authentication', () => {
  describe('without API key configured', () => {
    it('should allow POST /api/logs without auth', async () => {
      const app = createTestApp(); // No apiKey

      const response = await app.request('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 30, msg: 'Test' }),
      });

      expect(response.status).toBe(201);
    });

    it('should allow GET /api/logs without auth', async () => {
      const app = createTestApp();

      const response = await app.request('/api/logs');

      expect(response.status).toBe(200);
    });

    it('should allow DELETE /api/logs without auth', async () => {
      const app = createTestApp();

      const response = await app.request('/api/logs', { method: 'DELETE' });

      expect(response.status).toBe(200);
    });

    it('should allow GET /api/channels without auth', async () => {
      const app = createTestApp();

      const response = await app.request('/api/channels');

      expect(response.status).toBe(200);
    });

    it('should allow GET /api/logs/stream without auth', async () => {
      const app = createTestApp();

      const response = await app.request('/api/logs/stream');

      expect(response.status).toBe(200);
    });
  });

  describe('with API key configured', () => {
    describe('valid authentication', () => {
      it('should allow requests with valid X-API-KEY header', async () => {
        const app = createTestApp({ apiKey: API_KEY });

        const response = await app.request('/api/logs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': API_KEY,
          },
          body: JSON.stringify({ level: 30, msg: 'Test' }),
        });

        expect(response.status).toBe(201);
      });

      it('should allow requests with valid apiKey query parameter', async () => {
        const app = createTestApp({ apiKey: API_KEY });

        const response = await app.request(`/api/logs?apiKey=${API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level: 30, msg: 'Test' }),
        });

        expect(response.status).toBe(201);
      });

      it('should work with header for GET /api/logs', async () => {
        const app = createTestApp({ apiKey: API_KEY });

        const response = await app.request('/api/logs', {
          headers: { 'X-API-KEY': API_KEY },
        });

        expect(response.status).toBe(200);
      });

      it('should work with query param for DELETE /api/logs', async () => {
        const app = createTestApp({ apiKey: API_KEY });

        const response = await app.request(`/api/logs?apiKey=${API_KEY}`, {
          method: 'DELETE',
        });

        expect(response.status).toBe(200);
      });

      it('should work with header for GET /api/channels', async () => {
        const app = createTestApp({ apiKey: API_KEY });

        const response = await app.request('/api/channels', {
          headers: { 'X-API-KEY': API_KEY },
        });

        expect(response.status).toBe(200);
      });
    });

    describe('invalid authentication', () => {
      it('should reject requests with wrong API key', async () => {
        const app = createTestApp({ apiKey: API_KEY });

        const response = await app.request('/api/logs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': 'wrong-key',
          },
          body: JSON.stringify({ level: 30, msg: 'Test' }),
        });

        expect(response.status).toBe(401);
        const json = await response.json();
        expect(json.error).toBe('Unauthorized');
      });

      it('should reject requests without API key', async () => {
        const app = createTestApp({ apiKey: API_KEY });

        const response = await app.request('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level: 30, msg: 'Test' }),
        });

        expect(response.status).toBe(401);
      });

      it('should reject GET /api/logs without auth', async () => {
        const app = createTestApp({ apiKey: API_KEY });

        const response = await app.request('/api/logs');

        expect(response.status).toBe(401);
      });

      it('should reject DELETE /api/logs without auth', async () => {
        const app = createTestApp({ apiKey: API_KEY });

        const response = await app.request('/api/logs', { method: 'DELETE' });

        expect(response.status).toBe(401);
      });

      it('should reject GET /api/channels without auth', async () => {
        const app = createTestApp({ apiKey: API_KEY });

        const response = await app.request('/api/channels');

        expect(response.status).toBe(401);
      });
    });

    describe('SSE special case', () => {
      it('should allow GET /api/logs/stream without API key', async () => {
        const app = createTestApp({ apiKey: API_KEY });

        const response = await app.request('/api/logs/stream');

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toContain('text/event-stream');
      });

      it('should also allow GET /api/logs/stream with valid API key', async () => {
        const app = createTestApp({ apiKey: API_KEY });

        const response = await app.request('/api/logs/stream', {
          headers: { 'X-API-KEY': API_KEY },
        });

        expect(response.status).toBe(200);
      });

      it('should reject GET /api/logs/stream with invalid API key', async () => {
        const app = createTestApp({ apiKey: API_KEY });

        const response = await app.request('/api/logs/stream', {
          headers: { 'X-API-KEY': 'wrong-key' },
        });

        expect(response.status).toBe(401);
      });
    });
  });
});
