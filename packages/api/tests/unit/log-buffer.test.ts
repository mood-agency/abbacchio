import { describe, it, expect, jest } from 'bun:test';
import { LogBuffer, getLogBuffer, DEFAULT_CHANNEL } from '../../src/lib/log-buffer.js';

describe('LogBuffer', () => {
  describe('constructor', () => {
    it('should create a buffer with size 0 (no storage)', () => {
      const buffer = new LogBuffer();
      expect(buffer.size).toBe(0);
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


    it('should add to specified channel', () => {
      const buffer = new LogBuffer();
      const entry = buffer.add({ level: 30, msg: 'Test' }, 'my-app');

      expect(entry.channel).toBe('my-app');
    });

    it('should update channel logCount on add', () => {
      const buffer = new LogBuffer();
      buffer.add({ level: 30, msg: 'Test' });

      const info = buffer.getChannelInfo(DEFAULT_CHANNEL);
      expect(info?.logCount).toBe(1);
    });

    it('should register channel on add', () => {
      const buffer = new LogBuffer();
      buffer.add({ level: 30, msg: 'Test' }, 'my-app');

      expect(buffer.getChannels()).toContain('my-app');
      const info = buffer.getChannelInfo('my-app');
      expect(info?.logCount).toBe(1);
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
    });

    it('should update channel logCount for batch', () => {
      const buffer = new LogBuffer();
      buffer.addBatch([{ level: 30, msg: 'Log 1' }, { level: 30, msg: 'Log 2' }]);

      const info = buffer.getChannelInfo(DEFAULT_CHANNEL);
      expect(info?.logCount).toBe(2);
    });

    it('should register channel for batch', () => {
      const buffer = new LogBuffer();
      buffer.addBatch([{ level: 30, msg: 'Log 1' }], 'my-app');

      expect(buffer.getChannels()).toContain('my-app');
      const info = buffer.getChannelInfo('my-app');
      expect(info?.logCount).toBe(1);
    });
  });

  describe('getAll()', () => {
    it('should return stored logs', () => {
      const buffer = new LogBuffer();
      buffer.add({ level: 30, msg: 'Log 1' });
      buffer.add({ level: 30, msg: 'Log 2' });

      const logs = buffer.getAll();

      expect(logs).toHaveLength(2);
      expect(logs[0].msg).toBe('Log 1');
      expect(logs[1].msg).toBe('Log 2');
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
    it('should reset channels to default when clearing all', () => {
      const buffer = new LogBuffer();
      buffer.add({ level: 30, msg: 'Test' }, 'app-1');

      buffer.clear();

      expect(buffer.getChannels()).toEqual([DEFAULT_CHANNEL]);
    });

    it('should emit clear event', () => {
      const buffer = new LogBuffer();
      const callback = jest.fn();
      buffer.on('clear', callback);

      buffer.clear();

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSize()', () => {
    it('should return count of stored logs', () => {
      const buffer = new LogBuffer();
      buffer.add({ level: 30, msg: 'Log 1' });
      buffer.add({ level: 30, msg: 'Log 2' });

      expect(buffer.getSize()).toBe(2);
    });
  });

  describe('getStats()', () => {
    it('should return buffer stats', () => {
      const buffer = new LogBuffer();
      buffer.add({ level: 30, msg: 'Test' }, 'app-1');
      buffer.add({ level: 30, msg: 'Test' }, 'app-2');

      const stats = buffer.getStats();
      expect(stats.channelCount).toBe(3); // default + app-1 + app-2
      expect(stats.channels).toHaveLength(3);
    });
  });

  describe('channel:added event', () => {
    it('should emit channel:added when new channel is used', () => {
      const buffer = new LogBuffer();
      const callback = jest.fn();
      buffer.on('channel:added', callback);

      buffer.add({ level: 30, msg: 'Test' }, 'new-channel');

      expect(callback).toHaveBeenCalledWith('new-channel');
    });

    it('should not emit channel:added for existing channel', () => {
      const buffer = new LogBuffer();
      buffer.add({ level: 30, msg: 'First' }, 'my-channel');

      const callback = jest.fn();
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
