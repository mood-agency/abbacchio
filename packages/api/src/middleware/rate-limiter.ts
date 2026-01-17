/**
 * Rate Limiting Middleware
 * Token bucket per IP with configurable window and max requests
 *
 * SECURITY: Proxy headers (x-forwarded-for, x-real-ip) are only trusted
 * when TRUST_PROXY=true is set. Otherwise, we use a fallback IP.
 */
import type { Context, Next, MiddlewareHandler } from 'hono';

// SECURITY: Only trust proxy headers when explicitly enabled
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

export interface RateLimiterConfig {
  windowMs: number;     // Time window in milliseconds
  maxRequests: number;  // Maximum requests per window
  keyGenerator?: (c: Context) => string; // Custom key generator
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10),
  maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '1000', 10),
};

/**
 * Get client IP from request
 * SECURITY: Only trusts proxy headers when TRUST_PROXY is enabled
 */
function getClientIp(c: Context): string {
  // SECURITY: Only check proxy headers if explicitly trusted
  // These headers can be spoofed by clients if there's no trusted proxy
  if (TRUST_PROXY) {
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) {
      // Take the first IP in the chain (original client)
      return forwarded.split(',')[0].trim();
    }

    const realIp = c.req.header('x-real-ip');
    if (realIp) {
      return realIp;
    }
  }

  // Fallback: use a hash of available identifying info
  // In most deployments without proxy, this will be a consistent identifier
  const userAgent = c.req.header('user-agent') || '';
  const acceptLanguage = c.req.header('accept-language') || '';

  // Create a simple hash for rate limiting purposes
  // This isn't perfect but provides some differentiation
  if (userAgent || acceptLanguage) {
    return `client_${simpleHash(userAgent + acceptLanguage)}`;
  }

  return 'unknown';
}

/**
 * Simple string hash for client identification
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

export class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private config: RateLimiterConfig;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanup();
  }

  /**
   * Start periodic cleanup of old buckets
   */
  private startCleanup(): void {
    // Clean up every window period
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const cutoff = now - this.config.windowMs * 2;

      for (const [key, bucket] of this.buckets) {
        if (bucket.lastRefill < cutoff) {
          this.buckets.delete(key);
        }
      }
    }, this.config.windowMs);
  }

  /**
   * Stop cleanup interval
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Try to consume a token for the given key
   * @returns true if request should be allowed, false if rate limited
   */
  tryConsume(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      // New bucket with full tokens
      bucket = {
        tokens: this.config.maxRequests - 1,
        lastRefill: now,
      };
      this.buckets.set(key, bucket);
      return true;
    }

    // Calculate tokens to add based on time elapsed
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor(elapsed / this.config.windowMs) * this.config.maxRequests;

    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(this.config.maxRequests, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }

    if (bucket.tokens > 0) {
      bucket.tokens--;
      return true;
    }

    return false;
  }

  /**
   * Get remaining tokens for a key
   */
  getRemaining(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) {
      return this.config.maxRequests;
    }

    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor(elapsed / this.config.windowMs) * this.config.maxRequests;

    return Math.min(this.config.maxRequests, bucket.tokens + tokensToAdd);
  }

  /**
   * Get time until next token available (ms)
   */
  getRetryAfter(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.tokens > 0) {
      return 0;
    }

    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    return Math.max(0, this.config.windowMs - elapsed);
  }

  /**
   * Clear all buckets (for testing)
   */
  clear(): void {
    this.buckets.clear();
  }

  /**
   * Get stats
   */
  getStats(): { totalBuckets: number; config: RateLimiterConfig } {
    return {
      totalBuckets: this.buckets.size,
      config: this.config,
    };
  }
}

// Singleton instance
let instance: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!instance) {
    instance = new RateLimiter();
  }
  return instance;
}

export function resetRateLimiter(): void {
  if (instance) {
    instance.stopCleanup();
    instance.clear();
  }
  instance = null;
}

/**
 * Create rate limiting middleware
 */
export function rateLimiter(config: Partial<RateLimiterConfig> = {}): MiddlewareHandler {
  const limiter = new RateLimiter(config);

  return async (c: Context, next: Next) => {
    const keyGenerator = config.keyGenerator || getClientIp;
    const key = keyGenerator(c);

    if (!limiter.tryConsume(key)) {
      const retryAfter = Math.ceil(limiter.getRetryAfter(key) / 1000);

      c.header('Retry-After', String(retryAfter));
      c.header('X-RateLimit-Limit', String(limiter.getStats().config.maxRequests));
      c.header('X-RateLimit-Remaining', '0');

      return c.json(
        { error: 'Too Many Requests', retryAfter },
        429
      );
    }

    // Add rate limit headers
    const remaining = limiter.getRemaining(key);
    c.header('X-RateLimit-Limit', String(limiter.getStats().config.maxRequests));
    c.header('X-RateLimit-Remaining', String(remaining));

    await next();
  };
}

/**
 * Create rate limiting middleware using the singleton instance
 */
export function createRateLimiterMiddleware(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const limiter = getRateLimiter();
    const key = getClientIp(c);

    if (!limiter.tryConsume(key)) {
      const retryAfter = Math.ceil(limiter.getRetryAfter(key) / 1000);

      c.header('Retry-After', String(retryAfter));
      c.header('X-RateLimit-Limit', String(limiter.getStats().config.maxRequests));
      c.header('X-RateLimit-Remaining', '0');

      return c.json(
        { error: 'Too Many Requests', retryAfter },
        429
      );
    }

    // Add rate limit headers
    const remaining = limiter.getRemaining(key);
    c.header('X-RateLimit-Limit', String(limiter.getStats().config.maxRequests));
    c.header('X-RateLimit-Remaining', String(remaining));

    await next();
  };
}
