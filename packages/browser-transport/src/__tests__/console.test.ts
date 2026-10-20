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
  getEndpoint: () => 'http://localhost/api/logs',
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

  it('captures every level when none is configured', () => {
    interceptConsole({ passthrough: false });

    console.debug('noisy');
    console.log('milestone');

    expect(mockClientInstance.add).toHaveBeenCalledTimes(2);
  });

  // Passthrough stays on here to show the level gates only what is forwarded to
  // the server, not what the developer sees. (The passthrough call itself uses
  // the console captured at module load, so it is not visible to these spies.)
  it('drops entries below the configured level', () => {
    interceptConsole({ level: 'info', passthrough: true });

    console.debug('noisy');
    console.log('milestone');
    console.warn('careful');

    const forwarded = mockClientInstance.add.mock.calls.map((call) => call[0].msg);
    expect(forwarded).toEqual(['milestone', 'careful']);
  });

  it('retunes the level while capture is active', () => {
    interceptConsole({ level: 'info', passthrough: false });
    console.debug('before');
    expect(mockClientInstance.add).not.toHaveBeenCalled();

    interceptConsole({ level: 'debug' });
    console.debug('after');
    expect(mockClientInstance.add).toHaveBeenCalledTimes(1);
    expect(mockClientInstance.add.mock.calls[0][0].msg).toBe('after');

    interceptConsole({ level: 'error' });
    console.warn('suppressed');
    expect(mockClientInstance.add).toHaveBeenCalledTimes(1);
  });

  it('accepts a numeric level and falls back to capturing all on an unknown name', () => {
    interceptConsole({ level: 40, passthrough: false });
    console.log('dropped');
    console.error('kept');
    expect(mockClientInstance.add.mock.calls.map((c) => c[0].msg)).toEqual(['kept']);

    interceptConsole({ level: 'verbose' as 'debug' });
    console.debug('now kept');
    expect(mockClientInstance.add.mock.calls.map((c) => c[0].msg)).toEqual([
      'kept',
      'now kept',
    ]);
  });

  it('resets the level floor after capture stops', () => {
    interceptConsole({ level: 'error', passthrough: false });
    stopInterceptConsole();

    interceptConsole({ passthrough: false });
    console.debug('captured again');

    expect(mockClientInstance.add).toHaveBeenCalledTimes(1);
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

  it('keeps log entries whose args contain BigInt', () => {
    interceptConsole({ passthrough: false });
    console.log('big', 10n, { nested: 5n });

    expect(mockClientInstance.add).toHaveBeenCalledTimes(1);
    const entry = mockClientInstance.add.mock.calls[0][0];
    expect(entry.msg).toContain('10n');
    expect(entry.nested).toBe('5n');
  });
});
