/**
 * Console interceptor for Abbacchio (OTLP native)
 * Intercepts console.log, console.error, etc. and sends them via OTLP
 */

import { AbbacchioClient, type AbbacchioClientOptions, type LogEntry } from './client.js';
import { LOG_LEVELS } from './logger.js';
import { startErrorCapture, stopErrorCapture } from './errors.js';
import { startPerfCapture, stopPerfCapture } from './perf.js';
import { startNetworkCapture, stopNetworkCapture, type NetworkCaptureOptions } from './network.js';

export interface ConsoleInterceptorOptions extends AbbacchioClientOptions, NetworkCaptureOptions {
  /**
   * Minimum level forwarded to the server — `'info'` drops `console.debug`.
   * Defaults to capturing every level. Passthrough to the real console is never
   * suppressed, so raising this only reduces what leaves the browser. Call
   * `interceptConsole({ level })` again to retune it while capture is active.
   */
  level?: number | keyof typeof LOG_LEVELS;
  /** App name to use as the logger name. Defaults to 'browser' */
  appName?: string;
  /** Whether to still output to the original console. Defaults to true */
  passthrough?: boolean;
  /** Include the current URL in log data. Defaults to true */
  includeUrl?: boolean;
  /** Include the user agent in log data. Defaults to false */
  includeUserAgent?: boolean;
  /** Capture stack traces for log location. Defaults to false */
  captureStackTrace?: boolean;
  /** Capture uncaught JavaScript exceptions. Defaults to false */
  captureErrors?: boolean;
  /** Capture unhandled promise rejections. Defaults to false */
  captureUnhandledRejections?: boolean;
  /** Capture main-thread long tasks (>50ms) via PerformanceObserver. Defaults to false */
  captureLongTasks?: boolean;
  /** Capture slow input/message handlers via Event Timing API. Defaults to false */
  captureSlowEvents?: boolean;
  /** Duration threshold (ms) for slow events. Defaults to 50 */
  slowEventThresholdMs?: number;
  /** Capture memory consumption. Defaults to false */
  captureMemory?: boolean;
  /** Interval in ms for memory capture. Defaults to 10000 (10s) */
  memoryCaptureIntervalMs?: number;
}

const LEVEL_MAP: Record<string, number> = {
  debug: 20,
  log: 30,
  info: 30,
  warn: 40,
  error: 50,
};

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

let client: AbbacchioClient | null = null;
let options: ConsoleInterceptorOptions = {};
let isIntercepting = false;

// Floor applied to captured console output. Unset means capture everything, so
// callers that never pass `level` keep the original behaviour.
const DEFAULT_MIN_LEVEL = LOG_LEVELS.trace;
let minLevel: number = DEFAULT_MIN_LEVEL;

function resolveMinLevel(level: ConsoleInterceptorOptions['level']): number {
  if (typeof level === 'number') return level;
  if (typeof level === 'string') return LOG_LEVELS[level] ?? DEFAULT_MIN_LEVEL;
  return DEFAULT_MIN_LEVEL;
}

function safeSerialize(value: unknown, seen = new WeakSet()): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;
  if (typeof value !== 'object') return value;

  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (value instanceof Error) {
    return { __type: 'Error', name: value.name, message: value.message, stack: value.stack };
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return value.toString();
  if (Array.isArray(value)) return value.map(item => safeSerialize(item, seen));

  if (typeof Element !== 'undefined' && value instanceof Element) {
    return `[Element: ${value.tagName.toLowerCase()}${value.id ? '#' + value.id : ''}]`;
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as object)) {
    try {
      result[key] = safeSerialize((value as Record<string, unknown>)[key], seen);
    } catch {
      result[key] = '[Unserializable]';
    }
  }
  return result;
}

function formatArgs(args: unknown[]): { msg: string; data: unknown | null } {
  const serialized = args.map(arg => safeSerialize(arg));
  const msgParts: string[] = [];
  const dataObjects: unknown[] = [];

  for (const item of serialized) {
    if (typeof item === 'string') {
      msgParts.push(item);
    } else if (typeof item === 'number' || typeof item === 'boolean') {
      msgParts.push(String(item));
    } else if (item === null) {
      msgParts.push('null');
    } else if (item === undefined) {
      msgParts.push('undefined');
    } else {
      dataObjects.push(item);
      msgParts.push(JSON.stringify(item));
    }
  }

  return {
    msg: msgParts.join(' '),
    data: dataObjects.length > 0 ? (dataObjects.length === 1 ? dataObjects[0] : dataObjects) : null,
  };
}

function getCallerLocation(): { file: string; line: number; column: number; function: string } | null {
  if (!options.captureStackTrace) return null;

  try {
    const stack = new Error().stack;
    if (!stack) return null;

    const lines = stack.split('\n');
    for (const line of lines) {
      if (
        line.includes('console.ts') ||
        line.includes('createInterceptor') ||
        line.includes('at console.') ||
        line.includes('at Object.') ||
        line.trim() === 'Error'
      ) continue;

      const match = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);
      if (match) {
        return {
          function: match[1] || 'anonymous',
          file: match[2],
          line: parseInt(match[3], 10),
          column: parseInt(match[4], 10),
        };
      }
    }
  } catch { /* ignore */ }
  return null;
}

function createLogEntry(args: unknown[], level: number): LogEntry {
  const { msg, data } = formatArgs(args);
  const location = getCallerLocation();

  const entry: LogEntry = {
    level,
    time: Date.now(),
    name: options.appName || 'browser',
    msg,
  };

  if (options.includeUrl !== false && typeof window !== 'undefined') {
    entry.url = window.location.href;
  }

  if (options.includeUserAgent && typeof navigator !== 'undefined') {
    entry.userAgent = navigator.userAgent;
  }

  if (location) {
    entry.caller = location;
  }

  if (data) {
    if (typeof data === 'object' && !Array.isArray(data)) {
      Object.assign(entry, data);
    } else {
      entry.data = data;
    }
  }

  return entry;
}

function createInterceptor(method: keyof typeof originalConsole) {
  return function (...args: unknown[]) {
    // The developer's own console output is never suppressed by `level`.
    if (options.passthrough !== false) {
      originalConsole[method](...args);
    }

    const level = LEVEL_MAP[method] ?? LOG_LEVELS.info;
    if (isIntercepting && client && level >= minLevel) {
      try {
        client.add(createLogEntry(args, level));
      } catch { /* don't break the app */ }
    }
  };
}

export function interceptConsole(opts: ConsoleInterceptorOptions = {}): void {
  if (isIntercepting) {
    options = { ...options, ...opts };
    minLevel = resolveMinLevel(options.level);
    if (client) client.configure(opts);
    if (opts.captureErrors !== undefined || opts.captureUnhandledRejections !== undefined) {
      stopErrorCapture();
      if (options.captureErrors || options.captureUnhandledRejections) {
        startErrorCapture(options, (entry) => { if (client) client.add(entry); });
      }
    }
    if (
      opts.captureLongTasks !== undefined ||
      opts.captureSlowEvents !== undefined ||
      opts.slowEventThresholdMs !== undefined ||
      opts.captureMemory !== undefined ||
      opts.memoryCaptureIntervalMs !== undefined
    ) {
      stopPerfCapture();
      if (options.captureLongTasks || options.captureSlowEvents || options.captureMemory) {
        startPerfCapture(options, (entry) => { if (client) client.add(entry); });
      }
    }
    if (
      opts.captureFetch !== undefined ||
      opts.captureXhr !== undefined ||
      opts.captureWebSockets !== undefined
    ) {
      stopNetworkCapture();
      if (options.captureFetch || options.captureXhr || options.captureWebSockets) {
        startNetworkCapture(options, (entry) => { if (client) client.add(entry); });
      }
    }
    return;
  }

  options = opts;
  minLevel = resolveMinLevel(options.level);
  client = new AbbacchioClient(opts);
  isIntercepting = true;

  console.log = createInterceptor('log');
  console.info = createInterceptor('info');
  console.warn = createInterceptor('warn');
  console.error = createInterceptor('error');
  console.debug = createInterceptor('debug');

  if (options.captureErrors || options.captureUnhandledRejections) {
    startErrorCapture(options, (entry) => { if (client) client.add(entry); });
  }

  if (options.captureLongTasks || options.captureSlowEvents || options.captureMemory) {
    startPerfCapture(options, (entry) => { if (client) client.add(entry); });
  }

  if (options.captureFetch || options.captureXhr || options.captureWebSockets) {
    if (!options.ignoreNetworkUrls && options.endpoint) {
      options.ignoreNetworkUrls = [options.endpoint];
    }
    startNetworkCapture({ ...options, name: options.appName }, (entry) => { if (client) client.add(entry); });
  }
}

export function stopInterceptConsole(): void {
  if (!isIntercepting) return;
  isIntercepting = false;
  minLevel = DEFAULT_MIN_LEVEL;
  stopErrorCapture();
  stopPerfCapture();
  stopNetworkCapture();

  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.debug = originalConsole.debug;

  if (client) {
    client.close();
    client = null;
  }
}

export async function flushConsole(): Promise<void> {
  if (client) await client.flush();
}

export function isConsoleIntercepted(): boolean {
  return isIntercepting;
}

export function getOriginalConsole(): typeof originalConsole {
  return originalConsole;
}
