import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, createLogger, LOG_LEVELS } from '../logger.js';
import { AbbacchioClient } from '../client.js';
import * as networkMod from '../network.js';

const mockClientInstance = {
  add: vi.fn(),
  addMetric: vi.fn(),
  addSpan: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  configure: vi.fn(),
  endpoint: 'http://localhost/api/logs',
};

// Mock the client and network capture
vi.mock('../client.js', () => {
  return {
    AbbacchioClient: vi.fn(function() { return mockClientInstance; }),
  };
});

vi.mock('../network.js', () => ({
  startNetworkCapture: vi.fn(),
  stopNetworkCapture: vi.fn(),
}));

describe('Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(mockClientInstance).forEach(mock => {
      if (typeof mock.mockClear === 'function') mock.mockClear();
    });
  });

  describe('initialization', () => {
    it('should create a logger with default options', () => {
      const logger = createLogger();
      expect(logger).toBeInstanceOf(Logger);
      expect(AbbacchioClient).toHaveBeenCalledWith({});
    });

    it('should pass options to client and start network capture if enabled', () => {
      createLogger({ name: 'test-app', level: 'warn', captureFetch: true });
      expect(AbbacchioClient).toHaveBeenCalledWith(expect.objectContaining({ name: 'test-app' }));
      expect(networkMod.startNetworkCapture).toHaveBeenCalledWith(
        expect.objectContaining({ captureFetch: true, name: 'test-app' }),
        expect.any(Function)
      );
    });
  });

  describe('logging levels', () => {
    it('should log messages at appropriate levels', () => {
      const logger = createLogger({ level: 'trace' });

      logger.trace('trace message');
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');
      logger.fatal('fatal message');

      expect(mockClientInstance.add).toHaveBeenCalledTimes(6);
      expect(mockClientInstance.add.mock.calls[0][0]).toMatchObject({ level: LOG_LEVELS.trace, msg: 'trace message' });
      expect(mockClientInstance.add.mock.calls[1][0]).toMatchObject({ level: LOG_LEVELS.debug, msg: 'debug message' });
      expect(mockClientInstance.add.mock.calls[2][0]).toMatchObject({ level: LOG_LEVELS.info, msg: 'info message' });
      expect(mockClientInstance.add.mock.calls[3][0]).toMatchObject({ level: LOG_LEVELS.warn, msg: 'warn message' });
      expect(mockClientInstance.add.mock.calls[4][0]).toMatchObject({ level: LOG_LEVELS.error, msg: 'error message' });
      expect(mockClientInstance.add.mock.calls[5][0]).toMatchObject({ level: LOG_LEVELS.fatal, msg: 'fatal message' });
    });

    it('should respect minimum log level', () => {
      const logger = createLogger({ level: 'warn' });

      logger.info('info message'); // Should be filtered out
      logger.warn('warn message'); // Should be logged
      logger.error('error message'); // Should be logged

      expect(mockClientInstance.add).toHaveBeenCalledTimes(2);
      expect(mockClientInstance.add.mock.calls[0][0].level).toBe(LOG_LEVELS.warn);
      expect(mockClientInstance.add.mock.calls[1][0].level).toBe(LOG_LEVELS.error);
    });

    it('should allow changing log level at runtime', () => {
      const logger = createLogger({ level: 'error' });

      logger.warn('ignored');
      logger.setLevel('warn');
      logger.warn('logged');

      expect(mockClientInstance.add).toHaveBeenCalledTimes(1);
      expect(mockClientInstance.add.mock.calls[0][0].msg).toBe('logged');
    });
  });

  describe('log method signatures', () => {
    it('should handle (msg, data) signature', () => {
      const logger = createLogger();

      logger.info('user logged in', { userId: 123 });
      
      expect(mockClientInstance.add).toHaveBeenCalledTimes(1);
      expect(mockClientInstance.add.mock.calls[0][0]).toMatchObject({
        msg: 'user logged in',
        userId: 123,
      });
    });

    it('should handle (data, msg) signature', () => {
      const logger = createLogger();

      logger.info({ userId: 123 }, 'user logged in');
      
      expect(mockClientInstance.add).toHaveBeenCalledTimes(1);
      expect(mockClientInstance.add.mock.calls[0][0]).toMatchObject({
        msg: 'user logged in',
        userId: 123,
      });
    });
  });

  describe('child loggers', () => {
    it('should inherit bindings and properties', () => {
      const parent = createLogger({ name: 'parent-app' });

      const child = parent.child({ component: 'auth' });
      child.info('login attempt');

      expect(mockClientInstance.add).toHaveBeenCalledTimes(1);
      expect(mockClientInstance.add.mock.calls[0][0]).toMatchObject({
        name: 'parent-app',
        msg: 'login attempt',
        component: 'auth',
      });
    });

    it('should allow nested child bindings', () => {
      const parent = createLogger();
      const child1 = parent.child({ level1: true });
      const child2 = child1.child({ level2: true });

      child2.info('deep child');

      expect(mockClientInstance.add.mock.calls[0][0]).toMatchObject({
        msg: 'deep child',
        level1: true,
        level2: true,
      });
    });
  });

  describe('dynamic network capture', () => {
    it('should start and stop network capture', () => {
      const logger = createLogger();
      
      logger.enableNetworkCapture({ captureXhr: true });
      expect(networkMod.startNetworkCapture).toHaveBeenCalledWith(
        expect.objectContaining({ captureXhr: true }),
        expect.any(Function)
      );

      logger.disableNetworkCapture();
      expect(networkMod.stopNetworkCapture).toHaveBeenCalled();
    });
  });

  describe('metrics and spans', () => {
    it('should forward metrics to client', () => {
      const logger = createLogger();

      const metric = { name: 'cpu', value: 50 };
      logger.metric(metric);
      
      expect(mockClientInstance.addMetric).toHaveBeenCalledWith(metric);
    });

    it('should create and end spans', () => {
      const logger = createLogger();

      const span = logger.startSpan('db.query');
      span.end('OK');

      expect(mockClientInstance.addSpan).toHaveBeenCalledTimes(1);
      const spanArg = mockClientInstance.addSpan.mock.calls[0][0];
      expect(spanArg.name).toBe('db.query');
      expect(spanArg.status.code).toBe(1); // OK
      expect(typeof spanArg.traceId).toBe('string');
      expect(typeof spanArg.spanId).toBe('string');
    });
  });
});
