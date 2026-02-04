/**
 * Browser HTTP client for Abbacchio
 * Handles batching, encryption, and sending logs to the server
 */

import { encrypt } from './crypto.js';

export interface AbbacchioClientOptions {
  /** Server URL endpoint */
  url?: string;
  /** Secret key for encryption. If provided, logs will be encrypted before sending */
  secretKey?: string;
  /** Channel/app name for multi-app support. Defaults to 'default' */
  channel?: string;
  /** Default namespace for all logs. Per-log namespace/name fields take precedence */
  namespace?: string;
  /** Number of logs to batch before sending. Defaults to 10 */
  batchSize?: number;
  /** Interval in ms between flushes. Defaults to 1000 */
  flushInterval?: number;
  /** Additional headers to send with requests */
  headers?: Record<string, string>;
  /** Whether to send logs to the server. Defaults to true */
  enabled?: boolean;
}

export interface LogEntry {
  level: number;
  time: number;
  msg: string;
  name?: string;
  [key: string]: unknown;
}

/**
 * Browser HTTP client for Abbacchio.
 * Handles batching, encryption, and HTTP communication.
 */
export class AbbacchioClient {
  private url: string;
  private secretKey?: string;
  private channel: string;
  private namespace?: string;
  private batchSize: number;
  private flushInterval: number;
  private headers: Record<string, string>;
  private enabled: boolean;

  private buffer: LogEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isClosed = false;

  constructor(options: AbbacchioClientOptions = {}) {
    this.url = options.url || 'http://localhost:4000/api/logs';
    this.secretKey = options.secretKey;
    this.channel = options.channel || 'default';
    this.namespace = options.namespace;
    this.batchSize = options.batchSize || 10;
    this.flushInterval = options.flushInterval || 1000;
    this.headers = options.headers || {};
    this.enabled = options.enabled ?? true;

    // Flush on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flush());
      window.addEventListener('pagehide', () => this.flush());
    }
  }

  /**
   * Process a log entry: inject default namespace, then encrypt if needed
   */
  private async processLog(log: LogEntry): Promise<unknown> {
    let processed: LogEntry = log;

    if (this.namespace && !processed.namespace && !processed.name) {
      processed = { ...processed, namespace: this.namespace };
    }

    if (this.secretKey) {
      return { encrypted: await encrypt(JSON.stringify(processed), this.secretKey) };
    }
    return processed;
  }

  /**
   * Enable sending logs to the server
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * Disable sending logs to the server. Logs will be silently dropped.
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Check if the client is currently enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Add a log to the buffer and trigger send if needed
   */
  add(log: LogEntry): void {
    if (!this.enabled || this.isClosed) return;

    this.buffer.push(log);

    if (this.buffer.length >= this.batchSize) {
      this.flush();
    } else {
      this.scheduleSend();
    }
  }

  /**
   * Schedule a send after the interval
   */
  private scheduleSend(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.flushInterval);
  }

  /**
   * Flush the buffer and send to server
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const toSend = this.buffer;
    this.buffer = [];

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // Process logs (encrypt if needed)
    const processedLogs = await Promise.all(toSend.map(log => this.processLog(log)));

    await this.sendToServer(processedLogs);
  }

  /**
   * Send logs to the Abbacchio server
   */
  private async sendToServer(logs: unknown[]): Promise<void> {
    try {
      await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Encrypted': this.secretKey ? 'true' : 'false',
          'X-Channel': this.channel,
          ...this.headers,
        },
        body: JSON.stringify({ logs }),
      });
    } catch {
      // Silently fail - don't break the app if Abbacchio server is down
    }
  }

  /**
   * Close the client and flush any remaining logs
   */
  async close(): Promise<void> {
    this.isClosed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  /**
   * Update client configuration
   */
  configure(options: Partial<AbbacchioClientOptions>): void {
    if (options.url !== undefined) this.url = options.url;
    if (options.secretKey !== undefined) this.secretKey = options.secretKey;
    if (options.channel !== undefined) this.channel = options.channel;
    if (options.namespace !== undefined) this.namespace = options.namespace;
    if (options.enabled !== undefined) this.enabled = options.enabled;
    if (options.batchSize !== undefined) this.batchSize = options.batchSize;
    if (options.flushInterval !== undefined) this.flushInterval = options.flushInterval;
    if (options.headers !== undefined) this.headers = options.headers;
  }
}

/**
 * Create a new Abbacchio client instance
 */
export function createClient(options?: AbbacchioClientOptions): AbbacchioClient {
  return new AbbacchioClient(options);
}
