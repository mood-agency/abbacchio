import { encrypt } from "./encrypt.js";

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
  interval?: number;
  /** Additional headers to send with requests */
  headers?: Record<string, string>;
}

/**
 * Shared HTTP client for all Abbacchio transports.
 * Handles batching, encryption, and HTTP communication.
 */
export class AbbacchioClient {
  private url: string;
  private secretKey?: string;
  private channel?: string;
  private namespace?: string;
  private batchSize: number;
  private interval: number;
  private headers: Record<string, string>;

  private buffer: unknown[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: AbbacchioClientOptions = {}) {
    this.url = options.url || "http://localhost:4000/api/logs";
    this.secretKey = options.secretKey;
    this.channel = options.channel;
    this.namespace = options.namespace;
    this.batchSize = options.batchSize || 10;
    this.interval = options.interval || 1000;
    this.headers = options.headers || {};
  }

  /**
   * Change the channel dynamically after initialization
   */
  setChannel(channel: string | undefined): void {
    this.channel = channel;
  }

  /**
   * Get the current channel
   */
  getChannel(): string | undefined {
    return this.channel;
  }

  /**
   * Change the namespace dynamically after initialization
   */
  setNamespace(namespace: string | undefined): void {
    this.namespace = namespace;
  }

  /**
   * Get the current namespace
   */
  getNamespace(): string | undefined {
    return this.namespace;
  }

  /**
   * Process a log entry: inject default namespace, then encrypt if needed
   */
  private processLog(log: unknown): unknown {
    let processed = log;

    if (this.namespace && typeof processed === 'object' && processed !== null) {
      const obj = processed as Record<string, unknown>;
      if (!obj.namespace && !obj.name) {
        processed = { ...obj, namespace: this.namespace };
      }
    }

    if (this.secretKey) {
      return { encrypted: encrypt(JSON.stringify(processed), this.secretKey) };
    }
    return processed;
  }

  /**
   * Add a log to the buffer and trigger send if needed
   */
  add(log: unknown): void {
    this.buffer.push(this.processLog(log));

    if (this.buffer.length >= this.batchSize) {
      this.flush();
    } else {
      this.scheduleSend();
    }
  }

  /**
   * Add multiple logs at once
   */
  addBatch(logs: unknown[]): void {
    for (const log of logs) {
      this.buffer.push(this.processLog(log));
    }

    if (this.buffer.length >= this.batchSize) {
      this.flush();
    } else {
      this.scheduleSend();
    }
  }

  /**
   * Send logs immediately without batching
   */
  async send(logs: unknown[]): Promise<void> {
    const processedLogs = logs.map(log => this.processLog(log));
    await this.sendToServer(processedLogs);
  }

  /**
   * Schedule a send after the interval
   */
  private scheduleSend(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.interval);
  }

  /**
   * Flush the buffer and send to server
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const toSend = this.buffer;
    this.buffer = [];

    await this.sendToServer(toSend);
  }

  /**
   * Send logs to the Abbacchio server
   */
  private async sendToServer(logs: unknown[]): Promise<void> {
    try {
      await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Encrypted": this.secretKey ? "true" : "false",
          ...(this.channel ? { "X-Channel": this.channel } : {}),
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
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}

/**
 * Create a new Abbacchio client instance
 */
export function createClient(options?: AbbacchioClientOptions): AbbacchioClient {
  return new AbbacchioClient(options);
}
