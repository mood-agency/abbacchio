import { describe, it, expect, vi } from 'vitest';
import { LogBuffer, getLogBuffer, DEFAULT_CHANNEL } from '../../src/lib/log-buffer.js';

describe('LogBuffer', () => {
  describe('constructor', () => {
    it('should create a buffer with default max size', () => {
      const buffer = new LogBuffer();
      expect(buffer.size).toBe(0);
    });

    it('should create a buffer with custom max size', () => {
      const buffer = new LogBuffer(50);
      // Add more than max to test circular behavior
      for (let i = 0; i < 60; i++) {
        buffer.add({ level: 30, msg: `Log ${i}` });
      }
      expect(buffer.size).toBe(50);
    });
  });

  describe('add()', () => {
    it('should add a log and return entry with ID', () => {
      const buffer = new LogBuffer();
      const entry = buffer.add({ level: 30, msg: 'Test message' });

      expect(entry.id).toBeDefined();
      expect(entry.msg).toBe('Test message');
      expect(entry.level).toBe(30);
      expect(entry.channel).toBe(DEFAULT_CHANNEL);
    });

    it('should normalize level to default 30 if not provided', () => {
      const buffer = new LogBuffer();
      const entry = buffer.add({ msg: 'No level' });

      expect(entry.level).toBe(30);
      expect(entry.levelLabel).toBe('info');
    });

    it('should normalize time to Date.now() if not provided', () => {
      const buffer = new LogBuffer();
      const before = Date.now();
      const entry = buffer.add({ level: 30, msg: 'No time' });
      const after = Date.now();

      expect(entry.time).toBeGreaterThanOrEqual(before);
      expect(entry.time).toBeLessThanOrEqual(after);
    });

    it('should normalize msg from message field (Winston style)', () => {
      const buffer = new LogBuffer();
      const entry = buffer.add({ level: 30, message: 'Winston message' });

      expect(entry.msg).toBe('Winston message');
    });

    it('should normalize namespace from name field', () => {
      const buffer = new LogBuffer();
      const entry = buffer.add({ level: 30, msg: 'Test', name: 'my-logger' });

      expect(entry.namespace).toBe('my-logger');
    });

    it('should put extra fields in data object', () => {
      const buffer = new LogBuffer();
      const entry = buffer.add({
        level: 30,
        msg: 'Test',
        customField: 'value',
        anotherField: 123,
      });

      expect(entry.data.customField).toBe('value');
      expect(entry.data.anotherField).toBe(123);
    });

    it('should assign correct levelLabel for all levels', () => {
      const buffer = new LogBuffer();
      const levels = [
        { level: 10, label: 'trace' },
        { level: 20, label: 'debug' },
        { level: 30, label: 'info' },
        { level: 40, label: 'warn' },
        { level: 50, label: 'error' },
        { level: 60, label: 'fatal' },
      ];

      for (const { level, label } of levels) {
        const entry = buffer.add({ level, msg: `Level ${level}` });
        expect(entry.levelLabel).toBe(label);
      }
    });

    it('should handle encrypted logs', () => {
      const buffer = new LogBuffer();
      const entry = buffer.add({ encrypted: 'base64encrypteddata' });

      expect(entry.encrypted).toBe(true);
      expect(entry.encryptedData).toBe('base64encrypteddata');
      expect(entry.msg).toBe('[Encrypted]');
    });

    it('should add to specified channel', () => {
      const buffer = new LogBuffer();
      const entry = buffer.add({ level: 30, msg: 'Test' }, 'my-app');

      expect(entry.channel).toBe('my-app');
    });

    it('should emit log event', () => {
      const buffer = new LogBuffer();
      const callback = vi.fn();
      buffer.on('log', callback);

      buffer.add({ level: 30, msg: 'Test' });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0].msg).toBe('Test');
    });

    it('should emit channel-specific log event', () => {
      const buffer = new LogBuffer();
      const callback = vi.fn();
      buffer.on('log:my-app', callback);

      buffer.add({ level: 30, msg: 'Test' }, 'my-app');

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('addBatch()', () => {
    it('should add multiple logs and return entries', () => {
      const buffer = new LogBuffer();
      const logs = [
        { level: 30, msg: 'Log 1' },
        { level: 40, msg: 'Log 2' },
        { level: 50, msg: 'Log 3' },
      ];

      const entries = buffer.addBatch(logs);

      expect(entries).toHaveLength(3);
      expect(buffer.size).toBe(3);
    });

    it('should emit batch event', () => {
      const buffer = new LogBuffer();
      const callback = vi.fn();
      buffer.on('batch', callback);

      buffer.addBatch([{ level: 30, msg: 'Log 1' }, { level: 30, msg: 'Log 2' }]);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0][0]).toHaveLength(2);
    });

    it('should emit channel-specific batch event', () => {
      const buffer = new LogBuffer();
      const callback = vi.fn();
      buffer.on('batch:my-app', callback);

      buffer.addBatch([{ level: 30, msg: 'Log 1' }], 'my-app');

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('circular buffer behavior', () => {
    it('should remove older logs when exceeding max size', () => {
      const buffer = new LogBuffer(5);

      for (let i = 0; i < 10; i++) {
        buffer.add({ level: 30, msg: `Log ${i}` });
      }

      expect(buffer.size).toBe(5);
      const logs = buffer.getAll();
      expect(logs[0].msg).toBe('Log 5');
      expect(logs[4].msg).toBe('Log 9');
    });

    it('should handle batch overflow correctly', () => {
      const buffer = new LogBuffer(5);

      const batch = Array.from({ length: 10 }, (_, i) => ({
        level: 30,
        msg: `Batch ${i}`,
      }));

      buffer.addBatch(batch);

      expect(buffer.size).toBe(5);
      const logs = buffer.getAll();
      expect(logs[0].msg).toBe('Batch 5');
    });
  });

  describe('getAll()', () => {
    it('should return all logs', () => {
      const buffer = new LogBuffer();
      buffer.add({ level: 30, msg: 'Log 1' });
      buffer.add({ level: 30, msg: 'Log 2' });

      const logs = buffer.getAll();

      expect(logs).toHaveLength(2);
    });

    it('should return copy of array', () => {
      const buffer = new LogBuffer();
      buffer.add({ level: 30, msg: 'Log 1' });

      const logs = buffer.getAll();
      logs.push({} as any);

      expect(buffer.size).toBe(1);
    });

    it('should filter by channel when provided', () => {
      const buffer = new LogBuffer();
      buffer.add({ level: 30, msg: 'App 1 log' }, 'app-1');
      buffer.add({ level: 30, msg: 'App 2 log' }, 'app-2');
      buffer.add({ level: 30, msg: 'App 1 log 2' }, 'app-1');

      const app1Logs = buffer.getAll('app-1');

      expect(app1Logs).toHaveLength(2);
      expect(app1Logs.every(l => l.channel === 'app-1')).toBe(true);
    });
  });

  describe('getChannels()', () => {
    it('should return default channel initially', () => {
      const buffer = new LogBuffer();
      const channels = buffer.getChannels();

      expect(channels).toContain(DEFAULT_CHANNEL);
    });

    it('should return all registered channels', () => {
      const buffer = new LogBuffer();
      buffer.add({ level: 30, msg: 'Test' }, 'app-1');
      buffer.add({ level: 30, msg: 'Test' }, 'app-2');

      const channels = buffer.getChannels();

      expect(channels).toContain(DEFAULT_CHANNEL);
      expect(channels).toContain('app-1');
      expect(channels).toContain('app-2');
    });
  });

  describe('clear()', () => {
    it('should clear all logs when no channel specified', () => {
      const buffer = new LogBuffer();
      buffer.add({ level: 30, msg: 'Log 1' }, 'app-1');
      buffer.add({ level: 30, msg: 'Log 2' }, 'app-2');

      buffer.clear();

      expect(buffer.size).toBe(0);
    });

    it('should reset channels to default when clearing all', () => {
      const buffer = new LogBuffer();
      buffer.add({ level: 30, msg: 'Test' }, 'app-1');

      buffer.clear();

      expect(buffer.getChannels()).toEqual([DEFAULT_CHANNEL]);
    });

    it('should clear only specified channel', () => {
      const buffer = new LogBuffer();
      buffer.add({ level: 30, msg: 'App 1' }, 'app-1');
      buffer.add({ level: 30, msg: 'App 2' }, 'app-2');

      buffer.clear('app-1');

      expect(buffer.getAll('app-1')).toHaveLength(0);
      expect(buffer.getAll('app-2')).toHaveLength(1);
    });

    it('should emit clear event', () => {
      const buffer = new LogBuffer();
      const callback = vi.fn();
      buffer.on('clear', callback);

      buffer.clear();

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should emit channel-specific clear event', () => {
      const buffer = new LogBuffer();
      const callback = vi.fn();
      buffer.on('clear:app-1', callback);

      buffer.clear('app-1');

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSize()', () => {
    it('should return total size', () => {
      const buffer = new LogBuffer();
      buffer.add({ level: 30, msg: 'Log 1' });
      buffer.add({ level: 30, msg: 'Log 2' });

      expect(buffer.getSize()).toBe(2);
    });

    it('should return size for specific channel', () => {
      const buffer = new LogBuffer();
      buffer.add({ level: 30, msg: 'App 1' }, 'app-1');
      buffer.add({ level: 30, msg: 'App 2' }, 'app-2');
      buffer.add({ level: 30, msg: 'App 1' }, 'app-1');

      expect(buffer.getSize('app-1')).toBe(2);
      expect(buffer.getSize('app-2')).toBe(1);
    });
  });

  describe('subscribe()', () => {
    it('should subscribe to all logs', () => {
      const buffer = new LogBuffer();
      const callback = vi.fn();

      buffer.subscribe(callback);
      buffer.add({ level: 30, msg: 'Test' });

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should subscribe to specific channel', () => {
      const buffer = new LogBuffer();
      const callback = vi.fn();

      buffer.subscribe(callback, 'app-1');
      buffer.add({ level: 30, msg: 'App 1' }, 'app-1');
      buffer.add({ level: 30, msg: 'App 2' }, 'app-2');

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should return unsubscribe function', () => {
      const buffer = new LogBuffer();
      const callback = vi.fn();

      const unsubscribe = buffer.subscribe(callback);
      buffer.add({ level: 30, msg: 'First' });

      unsubscribe();
      buffer.add({ level: 30, msg: 'Second' });

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('channel:added event', () => {
    it('should emit channel:added when new channel is used', () => {
      const buffer = new LogBuffer();
      const callback = vi.fn();
      buffer.on('channel:added', callback);

      buffer.add({ level: 30, msg: 'Test' }, 'new-channel');

      expect(callback).toHaveBeenCalledWith('new-channel');
    });

    it('should not emit channel:added for existing channel', () => {
      const buffer = new LogBuffer();
      buffer.add({ level: 30, msg: 'First' }, 'my-channel');

      const callback = vi.fn();
      buffer.on('channel:added', callback);
      buffer.add({ level: 30, msg: 'Second' }, 'my-channel');

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('getLogBuffer singleton', () => {
    it('should return same instance', () => {
      const buffer1 = getLogBuffer();
      const buffer2 = getLogBuffer();

      expect(buffer1).toBe(buffer2);
    });
  });
});
