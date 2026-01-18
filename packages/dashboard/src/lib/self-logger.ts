/**
 * Self-logger for the Abbacchio dashboard.
 * Intercepts console calls and sends them to the Abbacchio API
 * so you can view the dashboard's own logs within the dashboard.
 */

type LogLevel = 'debug' | 'log' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: number;
  msg: string;
  time: number;
  method: LogLevel;
  source: 'dashboard';
}

const levelToNumber: Record<LogLevel, number> = {
  debug: 20,
  log: 30,
  info: 30,
  warn: 40,
  error: 50,
};

// Store original console methods
const originalConsole: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: console.debug.bind(console),
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

let isInitialized = false;
let buffer: LogEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let apiUrl = '';
let channel = 'dashboard-logs';
const BATCH_SIZE = 10;
const INTERVAL = 1000;

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

async function flush(): Promise<void> {
  if (buffer.length === 0 || !apiUrl) return;

  const toSend = buffer;
  buffer = [];

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Encrypted': 'false',
        'X-Channel': channel,
      },
      body: JSON.stringify({ logs: toSend }),
    });
    if (!response.ok) {
      originalConsole.warn('[SelfLogger] Failed to send logs:', response.status, response.statusText);
    }
  } catch (err) {
    originalConsole.warn('[SelfLogger] Failed to send logs:', err);
  }
}

function scheduleSend(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, INTERVAL);
}

function addLog(method: LogLevel, args: unknown[]): void {
  const log: LogEntry = {
    level: levelToNumber[method],
    msg: formatArgs(args),
    time: Date.now(),
    method,
    source: 'dashboard',
  };

  buffer.push(log);

  if (buffer.length >= BATCH_SIZE) {
    flush();
  } else {
    scheduleSend();
  }
}

function createInterceptedMethod(method: LogLevel): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    // Send to Abbacchio API
    addLog(method, args);

    // Pass through to original console
    originalConsole[method](...args);
  };
}

export interface SelfLoggerOptions {
  /** API URL for sending logs. Defaults to current origin + /api/logs */
  url?: string;
  /** Channel name for the dashboard logs. Defaults to 'dashboard-logs' */
  channel?: string;
  /** Whether to enable self-logging. Defaults to true */
  enabled?: boolean;
}

/**
 * Initialize the self-logger to intercept console calls.
 * Call this early in app startup (e.g., in main.tsx).
 */
export function initSelfLogger(options: SelfLoggerOptions = {}): void {
  if (isInitialized) return;

  const enabled = options.enabled !== false;
  if (!enabled) return;

  // Default to current origin
  apiUrl = options.url || `${window.location.origin}/api/logs`;
  channel = options.channel || 'dashboard-logs';

  // Replace console methods
  const methods: LogLevel[] = ['debug', 'log', 'info', 'warn', 'error'];
  for (const method of methods) {
    (console as unknown as Record<string, unknown>)[method] = createInterceptedMethod(method);
  }

  isInitialized = true;

  // Log that we've started
  originalConsole.info('[SelfLogger] Initialized → url:', apiUrl, 'channel:', channel);
}

/**
 * Restore original console methods and flush remaining logs.
 */
export function stopSelfLogger(): void {
  if (!isInitialized) return;

  // Restore original console methods
  const methods: LogLevel[] = ['debug', 'log', 'info', 'warn', 'error'];
  for (const method of methods) {
    (console as unknown as Record<string, unknown>)[method] = originalConsole[method];
  }

  // Flush remaining logs
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  flush();

  isInitialized = false;
}

/**
 * Check if self-logger is initialized.
 */
export function isSelfLoggerActive(): boolean {
  return isInitialized;
}
