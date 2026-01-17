import { describe, it, expect, beforeEach } from 'vitest';
import { IdPool, getIdPool, resetIdPool } from '../../src/lib/id-pool.js';

describe('IdPool', () => {
  let pool: IdPool;

  beforeEach(() => {
    resetIdPool();
    pool = new IdPool({ poolSize: 100, refillThreshold: 20, batchSize: 50 });
  });

  describe('ID generation', () => {
    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        ids.add(pool.getId());
      }
      expect(ids.size).toBe(50);
    });

    it('should get multiple IDs at once', () => {
      const ids = pool.getIds(10);
      expect(ids.length).toBe(10);
      expect(new Set(ids).size).toBe(10);
    });

    it('should generate IDs even when pool is empty', () => {
      pool.clear();
      const id = pool.getId();
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });
  });

  describe('pool management', () => {
    it('should pre-fill pool on creation', () => {
      const newPool = new IdPool({ poolSize: 50, refillThreshold: 10, batchSize: 20 });
      expect(newPool.size).toBe(50);
    });

    it('should report health status', () => {
      expect(pool.isHealthy).toBe(true);

      // Drain below threshold
      for (let i = 0; i < 85; i++) {
        pool.getId();
      }

      expect(pool.isHealthy).toBe(false);
    });

    it('should force refill pool', () => {
      // Drain some IDs
      for (let i = 0; i < 80; i++) {
        pool.getId();
      }

      const sizeBefore = pool.size;
      pool.forceRefill();
      expect(pool.size).toBeGreaterThan(sizeBefore);
    });

    it('should clear pool', () => {
      expect(pool.size).toBeGreaterThan(0);
      pool.clear();
      expect(pool.size).toBe(0);
    });

    it('should provide stats', () => {
      const stats = pool.getStats();
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('isHealthy');
      expect(stats).toHaveProperty('isRefilling');
    });
  });

  describe('async refill', () => {
    it('should schedule refill when below threshold', async () => {
      // Drain below threshold
      for (let i = 0; i < 85; i++) {
        pool.getId();
      }

      const sizeBefore = pool.size;
      expect(sizeBefore).toBeLessThan(20);

      // Wait for async refill
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(pool.size).toBeGreaterThan(sizeBefore);
    });
  });

  describe('singleton', () => {
    it('should return singleton instance', () => {
      const instance1 = getIdPool();
      const instance2 = getIdPool();
      expect(instance1).toBe(instance2);
    });

    it('should reset singleton', () => {
      const instance1 = getIdPool();
      const initialSize = instance1.size;

      // Drain some IDs
      for (let i = 0; i < 100; i++) {
        instance1.getId();
      }

      resetIdPool();

      const instance2 = getIdPool();
      // New instance should have full pool
      expect(instance2.size).toBeGreaterThanOrEqual(initialSize - 100);
    });
  });
});
