import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  RateLimiter,
  rateLimiter,
  getRateLimiter,
  resetRateLimiter,
} from '../../src/middleware/rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    resetRateLimiter();
    limiter = new RateLimiter({ windowMs: 1000, maxRequests: 5 });
  });

  describe('token consumption', () => {
    it('should allow requests within limit', () => {
      for (let i = 0; i < 5; i++) {
        expect(limiter.tryConsume('test-key')).toBe(true);
      }
    });

    it('should block requests over limit', () => {
      for (let i = 0; i < 5; i++) {
        limiter.tryConsume('test-key');
      }
      expect(limiter.tryConsume('test-key')).toBe(false);
    });

    it('should track separate keys independently', () => {
      for (let i = 0; i < 5; i++) {
        limiter.tryConsume('key-a');
      }

      expect(limiter.tryConsume('key-a')).toBe(false);
      expect(limiter.tryConsume('key-b')).toBe(true);
    });

    it('should report remaining tokens', () => {
      expect(limiter.getRemaining('test-key')).toBe(5);

      limiter.tryConsume('test-key');
      limiter.tryConsume('test-key');

      expect(limiter.getRemaining('test-key')).toBe(3);
    });
  });

  describe('token refill', () => {
    it('should refill tokens after window', async () => {
      const shortLimiter = new RateLimiter({ windowMs: 50, maxRequests: 3 });

      // Consume all tokens
      for (let i = 0; i < 3; i++) {
        shortLimiter.tryConsume('test-key');
      }
      expect(shortLimiter.tryConsume('test-key')).toBe(false);

      // Wait for window to pass
      await new Promise(resolve => setTimeout(resolve, 60));

      // Tokens should be refilled
      expect(shortLimiter.tryConsume('test-key')).toBe(true);
    });
  });

  describe('retry-after', () => {
    it('should return 0 when tokens available', () => {
      expect(limiter.getRetryAfter('test-key')).toBe(0);
    });

    it('should return time until next token when exhausted', () => {
      for (let i = 0; i < 5; i++) {
        limiter.tryConsume('test-key');
      }

      const retryAfter = limiter.getRetryAfter('test-key');
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(1000);
    });
  });

  describe('singleton', () => {
    it('should return singleton instance', () => {
      const instance1 = getRateLimiter();
      const instance2 = getRateLimiter();
      expect(instance1).toBe(instance2);
    });

    it('should reset singleton', () => {
      const instance1 = getRateLimiter();
      instance1.tryConsume('test');

      resetRateLimiter();

      const instance2 = getRateLimiter();
      expect(instance2.getRemaining('test')).toBe(
        instance2.getStats().config.maxRequests
      );
    });
  });
});

describe('rateLimiter middleware', () => {
  let app: Hono;

  beforeEach(() => {
    resetRateLimiter();
    app = new Hono();
    app.use('*', rateLimiter({ windowMs: 1000, maxRequests: 3 }));
    app.get('/test', (c) => c.json({ ok: true }));
  });

  it('should allow requests within limit', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/test');
      expect(res.status).toBe(200);
    }
  });

  it('should return 429 when limit exceeded', async () => {
    // Exhaust limit
    for (let i = 0; i < 3; i++) {
      await app.request('/test');
    }

    const res = await app.request('/test');
    expect(res.status).toBe(429);

    const body = await res.json();
    expect(body.error).toBe('Too Many Requests');
  });

  it('should include rate limit headers', async () => {
    const res = await app.request('/test');

    expect(res.headers.get('X-RateLimit-Limit')).toBe('3');
    expect(res.headers.get('X-RateLimit-Remaining')).toBeTruthy();
  });

  it('should include Retry-After header when rate limited', async () => {
    // Exhaust limit
    for (let i = 0; i < 3; i++) {
      await app.request('/test');
    }

    const res = await app.request('/test');
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });
});
