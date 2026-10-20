/**
 * Logger class for Abbacchio (OTLP native)
 * Provides a structured logging API similar to Pino
 */

import { AbbacchioClient, type AbbacchioClientOptions, type LogEntry, type MetricRecord } from './client.js';
import { startNetworkCapture, stopNetworkCapture, type NetworkCaptureOptions } from './network.js';
import { startWebVitalsCapture, stopWebVitalsCapture, type WebVitalsCaptureOptions } from './web-vitals.js';

export interface LoggerOptions extends AbbacchioClientOptions, NetworkCaptureOptions {
  /** Logger name (used as namespace attribute). Defaults to 'app' */
  name?: string;
  /** Minimum log level. Defaults to 'debug' (20) */
  level?: number | 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  /** Include the current URL in log data. Defaults to false */
  includeUrl?: boolean;
  /** Capture Web Vitals (LCP, INP, CLS, FCP, TTFB). Defaults to false */
  captureWebVitals?: boolean;
  /** Web Vitals capture options */
  webVitalsOptions?: Omit<WebVitalsCaptureOptions, 'appName' | 'includeUrl'>;
}

export function getMemoryUsageBytes(): number {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    return process.memoryUsage().heapUsed;
  }
  if (typeof performance !== 'undefined' && (performance as any).memory) {
    return (performance as any).memory.usedJSHeapSize;
  }
  return 0;
}

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
 * Browser logger for Abbacchio (OTLP native)
 */
export class Logger {
  private client: AbbacchioClient;
  private loggerName: string;
  private minLevel: number;
  private includeUrl: boolean;
  private bindings: Record<string, unknown> = {};

  constructor(options: LoggerOptions = {}) {
    this.client = new AbbacchioClient(options);
    this.loggerName = options.name || 'app';
    this.minLevel = this.parseLevel(options.level || 'debug');
    this.includeUrl = options.includeUrl ?? false;

    if (options.captureFetch || options.captureXhr || options.captureWebSockets) {
      this.enableNetworkCapture(options);
    }

    if (options.captureWebVitals) {
      this.enableWebVitals(options.webVitalsOptions);
    }
  }

  /** Dynamically enable network capture with options */
  enableNetworkCapture(options: NetworkCaptureOptions): void {
    const opts = { ...options };
    // Always ignore our own endpoint, even alongside user patterns, to avoid self-capture.
    opts.ignoreNetworkUrls = [...(opts.ignoreNetworkUrls ?? []), this.client.getEndpoint()];
    opts.name = opts.name || this.loggerName;
    startNetworkCapture(opts, (entry) => {
      this.client.add(entry);
    });
  }

  /** Dynamically disable network capture */
  disableNetworkCapture(): void {
    stopNetworkCapture();
  }

  /** Dynamically enable Web Vitals capture (LCP, INP, CLS, FCP, TTFB) */
  enableWebVitals(options?: Omit<WebVitalsCaptureOptions, 'appName' | 'includeUrl'>): void {
    startWebVitalsCapture(
      { ...options, appName: this.loggerName, includeUrl: this.includeUrl },
      (entry) => this.client.add(entry),
      (metric) => this.client.addMetric(metric),
    );
  }

  /** Dynamically disable Web Vitals capture */
  disableWebVitals(): void {
    stopWebVitalsCapture();
  }

  private parseLevel(level: number | LogLevel): number {
    if (typeof level === 'number') return level;
    return LOG_LEVELS[level] ?? LOG_LEVELS.info;
  }

  private createEntry(level: number, msg: string, data?: Record<string, unknown>): LogEntry {
    const entry: LogEntry = {
      level,
      time: Date.now(),
      name: this.loggerName,
      msg,
      ...this.bindings,
      ...data,
    };

    if (this.includeUrl && typeof window !== 'undefined') {
      entry.url = window.location.href;
    }

    return entry;
  }

  private log(level: number, msgOrData: string | Record<string, unknown>, dataOrMsg?: string | Record<string, unknown>): void {
    if (level < this.minLevel) return;

    let msg: string;
    let data: Record<string, unknown> | undefined;

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

  trace(msg: string, data?: Record<string, unknown>): void;
  trace(data: Record<string, unknown>, msg?: string): void;
  trace(msgOrData: string | Record<string, unknown>, dataOrMsg?: string | Record<string, unknown>): void {
    this.log(LOG_LEVELS.trace, msgOrData, dataOrMsg);
  }

  debug(msg: string, data?: Record<string, unknown>): void;
  debug(data: Record<string, unknown>, msg?: string): void;
  debug(msgOrData: string | Record<string, unknown>, dataOrMsg?: string | Record<string, unknown>): void {
    this.log(LOG_LEVELS.debug, msgOrData, dataOrMsg);
  }

  info(msg: string, data?: Record<string, unknown>): void;
  info(data: Record<string, unknown>, msg?: string): void;
  info(msgOrData: string | Record<string, unknown>, dataOrMsg?: string | Record<string, unknown>): void {
    this.log(LOG_LEVELS.info, msgOrData, dataOrMsg);
  }

  warn(msg: string, data?: Record<string, unknown>): void;
  warn(data: Record<string, unknown>, msg?: string): void;
  warn(msgOrData: string | Record<string, unknown>, dataOrMsg?: string | Record<string, unknown>): void {
    this.log(LOG_LEVELS.warn, msgOrData, dataOrMsg);
  }

  error(msg: string, data?: Record<string, unknown>): void;
  error(data: Record<string, unknown>, msg?: string): void;
  error(msgOrData: string | Record<string, unknown>, dataOrMsg?: string | Record<string, unknown>): void {
    this.log(LOG_LEVELS.error, msgOrData, dataOrMsg);
  }

  fatal(msg: string, data?: Record<string, unknown>): void;
  fatal(data: Record<string, unknown>, msg?: string): void;
  fatal(msgOrData: string | Record<string, unknown>, dataOrMsg?: string | Record<string, unknown>): void {
    this.log(LOG_LEVELS.fatal, msgOrData, dataOrMsg);
  }

  metric(record: MetricRecord): void {
    this.client.addMetric(record);
  }

  startSpan(name: string, attrs?: Record<string, string>): { end: (status?: 'OK' | 'ERROR', finalAttrs?: Record<string, string>) => void } {
    const traceId = crypto.randomUUID().replace(/-/g, '');
    const spanId = traceId.slice(0, 16);
    const startNano = BigInt(Date.now()) * 1_000_000n;

    return {
      end: (status: 'OK' | 'ERROR' = 'OK', finalAttrs?: Record<string, string>) => {
        const endNano = BigInt(Date.now()) * 1_000_000n;
        this.client.addSpan({
          traceId,
          spanId,
          name,
          kind: 1,
          startTimeUnixNano: startNano.toString(),
          endTimeUnixNano: endNano.toString(),
          attributes: { ...attrs, ...finalAttrs, 'logger.name': this.loggerName },
          status: { code: status === 'OK' ? 1 : 2 },
        });
      },
    };
  }

  async traceWithMemory<T>(
    name: string,
    operation: () => Promise<T> | T,
    attrs?: Record<string, string>
  ): Promise<T> {
    const startMemory = getMemoryUsageBytes();
    const span = this.startSpan(name, attrs);
    let hasError = false;

    try {
      return await operation();
    } catch (error) {
      hasError = true;
      throw error;
    } finally {
      const endMemory = getMemoryUsageBytes();
      const memoryDelta = endMemory - startMemory;

      const finalAttrs = {
        'memory.start_bytes': String(startMemory),
        'memory.end_bytes': String(endMemory),
        'memory.delta_bytes': String(memoryDelta),
        'memory.is_leak_suspect': String(memoryDelta > 50_000_000), // > 50MB
      };

      span.end(hasError ? 'ERROR' : 'OK', finalAttrs);
    }
  }

  child(bindings: Record<string, unknown>): Logger {
    const child = Object.create(this) as Logger;
    child.bindings = { ...this.bindings, ...bindings };
    return child;
  }

  async flush(): Promise<void> {
    await this.client.flush();
  }

  async close(): Promise<void> {
    stopNetworkCapture();
    stopWebVitalsCapture();
    await this.client.close();
  }

  setLevel(level: number | LogLevel): void {
    this.minLevel = this.parseLevel(level);
  }
}

export function createLogger(options?: LoggerOptions): Logger {
  return new Logger(options);
}
