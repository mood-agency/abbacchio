import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { interceptConsole, stopInterceptConsole } from '../console.js';
import { AbbacchioClient } from '../client.js';

const mockClientInstance = {
  add: vi.fn(),
  addMetric: vi.fn(),
  addSpan: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  configure: vi.fn(),
  endpoint: 'http://localhost/api/logs',
};

vi.mock('../client.js', () => {
  return {
    AbbacchioClient: vi.fn(function() { return mockClientInstance; }),
  };
});

describe('Console Interceptor', () => {
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalDebug = console.debug;

  let consoleSpies: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpies = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    stopInterceptConsole();
    vi.restoreAllMocks();
    // In case restoreConsole fails, forcefully restore to not break other tests
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
    console.debug = originalDebug;
  });

  it('should intercept console methods and forward to client', () => {
    interceptConsole({ appName: 'test-app', passthrough: false });

    console.log('hello world');
    console.error('some error', { code: 123 });

    expect(mockClientInstance.add).toHaveBeenCalledTimes(2);
    
    const logEntry = mockClientInstance.add.mock.calls[0][0];
    expect(logEntry.msg).toBe('hello world');
    expect(logEntry.level).toBe(30);
    expect(logEntry.name).toBe('test-app');

    const errorEntry = mockClientInstance.add.mock.calls[1][0];
    expect(errorEntry.msg).toBe('some error {"code":123}');
    expect(errorEntry.level).toBe(50);
    expect(errorEntry.code).toBe(123);
  });

  it('should format arguments properly', () => {
    interceptConsole({ passthrough: false });

    console.log('user', 'logged in', 123, true, null, undefined, { role: 'admin' });

    expect(mockClientInstance.add).toHaveBeenCalledTimes(1);
    const entry = mockClientInstance.add.mock.calls[0][0];
    
    // strings, numbers, booleans, null, undefined are concatenated into msg
    // objects are stringified and appended to msg, and also assigned to entry properties or data
    expect(entry.msg).toBe('user logged in 123 true null undefined {"role":"admin"}');
    expect(entry.role).toBe('admin');
  });

  it('should serialize cyclic objects safely', () => {
    interceptConsole({ passthrough: false });

    const cyclic: any = { name: 'cyclic' };
    cyclic.self = cyclic;

    console.info('cyclic obj', cyclic);

    expect(mockClientInstance.add).toHaveBeenCalledTimes(1);
    const entry = mockClientInstance.add.mock.calls[0][0];
    expect(entry.msg).toBe('cyclic obj {"name":"cyclic","self":"[Circular]"}');
    expect(entry.name).toBe('cyclic');
    expect(entry.self).toBe('[Circular]');
  });

  it('should extract caller location if captureStackTrace is true', () => {
    interceptConsole({ passthrough: false, captureStackTrace: true });

    function testLogLocation() {
      console.warn('warning message');
    }

    testLogLocation();

    expect(mockClientInstance.add).toHaveBeenCalledTimes(1);
    const entry = mockClientInstance.add.mock.calls[0][0];
    
    expect(entry.caller).toBeDefined();
    expect(entry.caller.function).toBe('testLogLocation');
    expect(entry.caller.file).toMatch(/console\.test\.ts$/);
    expect(typeof entry.caller.line).toBe('number');
  });
});
