/**
 * Pre-generated ID Pool
 * Eliminates crypto overhead on hot path by pre-generating nanoid values
 */
import { nanoid } from 'nanoid';

export interface IdPoolConfig {
  poolSize: number;       // Target pool size
  refillThreshold: number; // Refill when pool falls below this
  batchSize: number;       // How many IDs to generate per refill batch
}

const DEFAULT_CONFIG: IdPoolConfig = {
  poolSize: 10000,
  refillThreshold: 1000,
  batchSize: 1000,
};

export class IdPool {
  private pool: string[] = [];
  private config: IdPoolConfig;
  private isRefilling: boolean = false;

  constructor(config: Partial<IdPoolConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Initial fill
    this.fillPool();
  }

  /**
   * Synchronously fill the pool
   */
  private fillPool(): void {
    const needed = this.config.poolSize - this.pool.length;
    for (let i = 0; i < needed; i++) {
      this.pool.push(nanoid());
    }
  }

  /**
   * Asynchronously refill the pool in the background
   */
  private scheduleRefill(): void {
    if (this.isRefilling) return;
    if (this.pool.length >= this.config.refillThreshold) return;

    this.isRefilling = true;

    // Use setImmediate to avoid blocking the event loop
    setImmediate(() => {
      const needed = Math.min(
        this.config.batchSize,
        this.config.poolSize - this.pool.length
      );

      for (let i = 0; i < needed; i++) {
        this.pool.push(nanoid());
      }

      this.isRefilling = false;

      // Continue refilling if still below threshold
      if (this.pool.length < this.config.refillThreshold) {
        this.scheduleRefill();
      }
    });
  }

  /**
   * Get an ID from the pool (falls back to sync generation if empty)
   */
  getId(): string {
    // Check if we need to schedule a refill
    if (this.pool.length < this.config.refillThreshold) {
      this.scheduleRefill();
    }

    // Get from pool or generate on-demand
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }

    // Fallback: generate synchronously (shouldn't happen under normal load)
    return nanoid();
  }

  /**
   * Get multiple IDs at once (for batch operations)
   */
  getIds(count: number): string[] {
    const ids: string[] = [];

    for (let i = 0; i < count; i++) {
      ids.push(this.getId());
    }

    return ids;
  }

  /**
   * Get current pool size
   */
  get size(): number {
    return this.pool.length;
  }

  /**
   * Check if pool is healthy (above threshold)
   */
  get isHealthy(): boolean {
    return this.pool.length >= this.config.refillThreshold;
  }

  /**
   * Force refill to target size (blocking)
   */
  forceRefill(): void {
    this.fillPool();
  }

  /**
   * Clear the pool (for testing)
   */
  clear(): void {
    this.pool = [];
    this.isRefilling = false;
  }

  /**
   * Get pool stats
   */
  getStats(): { size: number; isHealthy: boolean; isRefilling: boolean } {
    return {
      size: this.pool.length,
      isHealthy: this.isHealthy,
      isRefilling: this.isRefilling,
    };
  }
}

// Singleton instance
let instance: IdPool | null = null;

export function getIdPool(): IdPool {
  if (!instance) {
    instance = new IdPool();
  }
  return instance;
}

export function resetIdPool(): void {
  if (instance) {
    instance.clear();
  }
  instance = null;
}
