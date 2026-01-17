import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConnectionManager,
  getConnectionManager,
  resetConnectionManager,
} from '../../src/lib/connection-manager.js';

describe('ConnectionManager', () => {
  let manager: ConnectionManager;

  beforeEach(() => {
    resetConnectionManager();
    manager = new ConnectionManager({ maxConnections: 10, connectionTimeout: 1000 });
  });

  describe('connection registration', () => {
    it('should register a new connection', () => {
      const id = manager.register('test-channel', '127.0.0.1');
      expect(id).toBeTruthy();
      expect(manager.size).toBe(1);
    });

    it('should return connection info', () => {
      const id = manager.register('test-channel', '127.0.0.1')!;
      const info = manager.get(id);

      expect(info).toBeDefined();
      expect(info?.channel).toBe('test-channel');
      expect(info?.ip).toBe('127.0.0.1');
      expect(info?.bytesSent).toBe(0);
      expect(info?.messagesSent).toBe(0);
    });

    it('should unregister a connection', () => {
      const id = manager.register('test-channel', '127.0.0.1')!;
      expect(manager.size).toBe(1);

      manager.unregister(id);
      expect(manager.size).toBe(0);
      expect(manager.get(id)).toBeUndefined();
    });
  });

  describe('connection limits', () => {
    it('should accept connections up to limit', () => {
      for (let i = 0; i < 10; i++) {
        const id = manager.register(`channel-${i}`, '127.0.0.1');
        expect(id).toBeTruthy();
      }
      expect(manager.size).toBe(10);
    });

    it('should reject connections over limit', () => {
      for (let i = 0; i < 10; i++) {
        manager.register(`channel-${i}`, '127.0.0.1');
      }

      const id = manager.register('overflow', '127.0.0.1');
      expect(id).toBeNull();
      expect(manager.size).toBe(10);
    });

    it('should report can accept connection correctly', () => {
      expect(manager.canAcceptConnection()).toBe(true);

      for (let i = 0; i < 10; i++) {
        manager.register(`channel-${i}`, '127.0.0.1');
      }

      expect(manager.canAcceptConnection()).toBe(false);
    });
  });

  describe('connection tracking', () => {
    it('should track bytes sent', () => {
      const id = manager.register('test', '127.0.0.1')!;
      manager.recordBytesSent(id, 100);
      manager.recordBytesSent(id, 200);

      const info = manager.get(id);
      expect(info?.bytesSent).toBe(300);
      expect(info?.messagesSent).toBe(2);
    });

    it('should track dropped messages', () => {
      const id = manager.register('test', '127.0.0.1')!;
      manager.recordDroppedMessage(id);
      manager.recordDroppedMessage(id);

      const info = manager.get(id);
      expect(info?.messagesDropped).toBe(2);
    });

    it('should update last activity on touch', async () => {
      const id = manager.register('test', '127.0.0.1')!;
      const info1 = manager.get(id)!;
      const firstActivity = info1.lastActivity;

      await new Promise(resolve => setTimeout(resolve, 10));
      manager.touch(id);

      const info2 = manager.get(id)!;
      expect(info2.lastActivity).toBeGreaterThan(firstActivity);
    });
  });

  describe('stale connection detection', () => {
    it('should detect stale connections', async () => {
      const shortTimeoutManager = new ConnectionManager({
        maxConnections: 10,
        connectionTimeout: 50,
      });

      const id = shortTimeoutManager.register('test', '127.0.0.1')!;
      expect(shortTimeoutManager.isStale(id)).toBe(false);

      await new Promise(resolve => setTimeout(resolve, 60));
      expect(shortTimeoutManager.isStale(id)).toBe(true);
    });

    it('should list stale connection IDs', async () => {
      const shortTimeoutManager = new ConnectionManager({
        maxConnections: 10,
        connectionTimeout: 50,
      });

      const id1 = shortTimeoutManager.register('test1', '127.0.0.1')!;
      await new Promise(resolve => setTimeout(resolve, 60));

      const id2 = shortTimeoutManager.register('test2', '127.0.0.1')!;

      const staleIds = shortTimeoutManager.getStaleConnectionIds();
      expect(staleIds).toContain(id1);
      expect(staleIds).not.toContain(id2);
    });

    it('should cleanup stale connections', async () => {
      const shortTimeoutManager = new ConnectionManager({
        maxConnections: 10,
        connectionTimeout: 50,
      });

      shortTimeoutManager.register('test1', '127.0.0.1');
      await new Promise(resolve => setTimeout(resolve, 60));

      shortTimeoutManager.register('test2', '127.0.0.1');

      expect(shortTimeoutManager.size).toBe(2);

      const cleaned = shortTimeoutManager.cleanupStaleConnections();
      expect(cleaned.length).toBe(1);
      expect(shortTimeoutManager.size).toBe(1);
    });
  });

  describe('statistics', () => {
    it('should provide connection statistics', () => {
      manager.register('channel-a', '127.0.0.1');
      manager.register('channel-a', '127.0.0.2');
      manager.register('channel-b', '127.0.0.3');

      const stats = manager.getStats();
      expect(stats.totalConnections).toBe(3);
      expect(stats.connectionsByChannel['channel-a']).toBe(2);
      expect(stats.connectionsByChannel['channel-b']).toBe(1);
    });

    it('should get connections by channel', () => {
      manager.register('channel-a', '127.0.0.1');
      manager.register('channel-a', '127.0.0.2');
      manager.register('channel-b', '127.0.0.3');

      const channelA = manager.getByChannel('channel-a');
      expect(channelA.length).toBe(2);

      const channelB = manager.getByChannel('channel-b');
      expect(channelB.length).toBe(1);
    });
  });

  describe('singleton', () => {
    it('should return singleton instance', () => {
      const instance1 = getConnectionManager();
      const instance2 = getConnectionManager();
      expect(instance1).toBe(instance2);
    });

    it('should reset singleton', () => {
      const instance1 = getConnectionManager();
      instance1.register('test', '127.0.0.1');

      resetConnectionManager();

      const instance2 = getConnectionManager();
      expect(instance2.size).toBe(0);
    });
  });
});
