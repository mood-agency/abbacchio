/**
 * Console interceptor for Abbacchio
 * Intercepts console.log, console.error, etc. and sends them to Abbacchio server
 */

import { AbbacchioClient, type AbbacchioClientOptions, type LogEntry } from './client.js';

export interface ConsoleInterceptorOptions extends AbbacchioClientOptions {
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
}

// Map console methods to Pino log levels
const LEVEL_MAP: Record<string, number> = {
  debug: 20,
  log: 30,
  info: 30,
  warn: 40,
  error: 50,
};

// Store original console methods
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

/**
 * Safely serialize a value for logging
 */
function safeSerialize(value: unknown, seen = new WeakSet()): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;

  if (typeof value === 'function') {
    return `[Function: ${value.name || 'anonymous'}]`;
  }

  if (typeof value !== 'object') {
    return value;
  }

  // Handle circular references
  if (seen.has(value as object)) {
    return '[Circular]';
  }
  seen.add(value as object);

  // Handle special objects
  if (value instanceof Error) {
    return {
      __type: 'Error',
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof RegExp) {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(item => safeSerialize(item, seen));
  }

  // Handle DOM elements
  if (typeof Element !== 'undefined' && value instanceof Element) {
    return `[Element: ${value.tagName.toLowerCase()}${value.id ? '#' + value.id : ''}]`;
  }

  // Handle plain objects
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

/**
 * Format console arguments into a message and extra data
 */
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

/**
 * Get caller location from stack trace
 */
function getCallerLocation(): { file: string; line: number; column: number; function: string } | null {
  if (!options.captureStackTrace) return null;

  try {
    const stack = new Error().stack;
    if (!stack) return null;

    const lines = stack.split('\n');
    // Find the first line that's not from this file
    for (const line of lines) {
      if (
        line.includes('console.ts') ||
        line.includes('createInterceptor') ||
        line.includes('at console.') ||
        line.includes('at Object.') ||
        line.trim() === 'Error'
      ) {
        continue;
      }

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
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Create a log entry from console arguments
 */
function createLogEntry(method: string, args: unknown[]): LogEntry {
  const { msg, data } = formatArgs(args);
  const location = getCallerLocation();

  const entry: LogEntry = {
    level: LEVEL_MAP[method] || 30,
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

/**
 * Create an interceptor for a console method
 */
function createInterceptor(method: keyof typeof originalConsole) {
  return function (...args: unknown[]) {
    // Pass through to original console if enabled
    if (options.passthrough !== false) {
      originalConsole[method](...args);
    }

    // Send to Abbacchio if intercepting
    if (isIntercepting && client) {
      try {
        const entry = createLogEntry(method, args);
        client.add(entry);
      } catch {
        // Don't let logging errors break the app
      }
    }
  };
}

/**
 * Start intercepting console methods
 */
export function interceptConsole(opts: ConsoleInterceptorOptions = {}): void {
  if (isIntercepting) {
    // Update options and client config
    options = { ...options, ...opts };
    if (client) {
      client.configure(opts);
    }
    return;
  }

  options = opts;
  client = new AbbacchioClient(opts);
  isIntercepting = true;

  // Replace console methods
  console.log = createInterceptor('log');
  console.info = createInterceptor('info');
  console.warn = createInterceptor('warn');
  console.error = createInterceptor('error');
  console.debug = createInterceptor('debug');
}

/**
 * Stop intercepting console methods
 */
export function stopInterceptConsole(): void {
  if (!isIntercepting) return;

  isIntercepting = false;

  // Restore original console methods
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  console.debug = originalConsole.debug;

  // Flush and close client
  if (client) {
    client.close();
    client = null;
  }
}

/**
 * Flush any buffered logs
 */
export async function flushConsole(): Promise<void> {
  if (client) {
    await client.flush();
  }
}

/**
 * Check if console is currently being intercepted
 */
export function isConsoleIntercepted(): boolean {
  return isIntercepting;
}

/**
 * Get the original console methods (for internal use when passthrough is false)
 */
export function getOriginalConsole(): typeof originalConsole {
  return originalConsole;
}
