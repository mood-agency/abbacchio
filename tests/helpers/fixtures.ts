import type { IncomingLog } from '../../src/types.js';

/**
 * Sample log entry for testing
 */
export const sampleLog: IncomingLog = {
  level: 30,
  time: Date.now(),
  msg: 'Test log message',
  namespace: 'test-app',
};

/**
 * Sample logs at different levels
 */
export const sampleLogs = {
  trace: { level: 10, msg: 'trace message' },
  debug: { level: 20, msg: 'debug message' },
  info: { level: 30, msg: 'info message' },
  warn: { level: 40, msg: 'warn message' },
  error: { level: 50, msg: 'error message' },
  fatal: { level: 60, msg: 'fatal message' },
};

/**
 * Winston-style log (uses 'message' and 'name' instead of 'msg' and 'namespace')
 */
export const winstonStyleLog: IncomingLog = {
  level: 30,
  message: 'Winston style message',
  name: 'winston-logger',
};

/**
 * Create a batch of logs for testing
 */
export function createLogBatch(count: number): IncomingLog[] {
  return Array.from({ length: count }, (_, i) => ({
    level: 30,
    time: Date.now() + i,
    msg: `Batch log ${i + 1}`,
    index: i,
  }));
}

/**
 * Create an encrypted log entry
 */
export function createEncryptedLog(data: string) {
  return { encrypted: data };
}

/**
 * Create a log with extra custom fields
 */
export function createLogWithExtras(extras: Record<string, unknown>): IncomingLog {
  return {
    level: 30,
    time: Date.now(),
    msg: 'Log with extras',
    ...extras,
  };
}
