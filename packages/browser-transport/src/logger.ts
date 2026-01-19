/**
 * Logger class for Abbacchio
 * Provides a structured logging API similar to Pino
 */

import { AbbacchioClient, type AbbacchioClientOptions, type LogEntry } from './client.js';

export interface LoggerOptions extends AbbacchioClientOptions {
  /** Logger name (namespace). Defaults to 'app' */
  name?: string;
  /** Minimum log level. Defaults to 'debug' (20) */
  level?: number | 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  /** Include the current URL in log data. Defaults to false */
  includeUrl?: boolean;
}

// Log level numbers (Pino compatible)
export const LOG_LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

/**
 * Browser logger for Abbacchio
 * Provides structured logging with automatic batching and optional encryption
 */
export class Logger {
  private client: AbbacchioClient;
  private name: string;
  private minLevel: number;
  private includeUrl: boolean;
  private bindings: Record<string, unknown> = {};

  constructor(options: LoggerOptions = {}) {
    this.client = new AbbacchioClient(options);
    this.name = options.name || 'app';
    this.minLevel = this.parseLevel(options.level || 'debug');
    this.includeUrl = options.includeUrl ?? false;
  }

  /**
   * Parse level string or number to numeric level
   */
  private parseLevel(level: number | LogLevel): number {
    if (typeof level === 'number') return level;
    return LOG_LEVELS[level] ?? LOG_LEVELS.info;
  }

  /**
   * Create a log entry
   */
  private createEntry(level: number, msg: string, data?: Record<string, unknown>): LogEntry {
    const entry: LogEntry = {
      level,
      time: Date.now(),
      name: this.name,
      msg,
      ...this.bindings,
      ...data,
    };

    if (this.includeUrl && typeof window !== 'undefined') {
      entry.url = window.location.href;
    }

    return entry;
  }

  /**
   * Internal log method
   */
  private log(level: number, msgOrData: string | Record<string, unknown>, dataOrMsg?: string | Record<string, unknown>): void {
    if (level < this.minLevel) return;

    let msg: string;
    let data: Record<string, unknown> | undefined;

    // Handle different call signatures:
    // log(level, 'message')
    // log(level, 'message', { data })
    // log(level, { data }, 'message')
    if (typeof msgOrData === 'string') {
      msg = msgOrData;
      data = typeof dataOrMsg === 'object' ? dataOrMsg : undefined;
    } else {
      data = msgOrData;
      msg = typeof dataOrMsg === 'string' ? dataOrMsg : '';
    }

    const entry = this.createEntry(level, msg, data);
    this.client.add(entry);
  }

  /**
   * Log at trace level (10)
   */
  trace(msg: string, data?: Record<string, unknown>): void;
  trace(data: Record<string, unknown>, msg?: string): void;
  trace(msgOrData: string | Record<string, unknown>, dataOrMsg?: string | Record<string, unknown>): void {
    this.log(LOG_LEVELS.trace, msgOrData, dataOrMsg);
  }

  /**
   * Log at debug level (20)
   */
  debug(msg: string, data?: Record<string, unknown>): void;
  debug(data: Record<string, unknown>, msg?: string): void;
  debug(msgOrData: string | Record<string, unknown>, dataOrMsg?: string | Record<string, unknown>): void {
    this.log(LOG_LEVELS.debug, msgOrData, dataOrMsg);
  }

  /**
   * Log at info level (30)
   */
  info(msg: string, data?: Record<string, unknown>): void;
  info(data: Record<string, unknown>, msg?: string): void;
  info(msgOrData: string | Record<string, unknown>, dataOrMsg?: string | Record<string, unknown>): void {
    this.log(LOG_LEVELS.info, msgOrData, dataOrMsg);
  }

  /**
   * Log at warn level (40)
   */
  warn(msg: string, data?: Record<string, unknown>): void;
  warn(data: Record<string, unknown>, msg?: string): void;
  warn(msgOrData: string | Record<string, unknown>, dataOrMsg?: string | Record<string, unknown>): void {
    this.log(LOG_LEVELS.warn, msgOrData, dataOrMsg);
  }

  /**
   * Log at error level (50)
   */
  error(msg: string, data?: Record<string, unknown>): void;
  error(data: Record<string, unknown>, msg?: string): void;
  error(msgOrData: string | Record<string, unknown>, dataOrMsg?: string | Record<string, unknown>): void {
    this.log(LOG_LEVELS.error, msgOrData, dataOrMsg);
  }

  /**
   * Log at fatal level (60)
   */
  fatal(msg: string, data?: Record<string, unknown>): void;
  fatal(data: Record<string, unknown>, msg?: string): void;
  fatal(msgOrData: string | Record<string, unknown>, dataOrMsg?: string | Record<string, unknown>): void {
    this.log(LOG_LEVELS.fatal, msgOrData, dataOrMsg);
  }

  /**
   * Create a child logger with additional bindings
   */
  child(bindings: Record<string, unknown>): Logger {
    const child = Object.create(this) as Logger;
    child.bindings = { ...this.bindings, ...bindings };
    return child;
  }

  /**
   * Flush buffered logs
   */
  async flush(): Promise<void> {
    await this.client.flush();
  }

  /**
   * Close the logger and flush remaining logs
   */
  async close(): Promise<void> {
    await this.client.close();
  }

  /**
   * Set the minimum log level
   */
  setLevel(level: number | LogLevel): void {
    this.minLevel = this.parseLevel(level);
  }
}

/**
 * Create a new logger instance
 */
export function createLogger(options?: LoggerOptions): Logger {
  return new Logger(options);
}
