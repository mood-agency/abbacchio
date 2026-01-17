import { Writable } from "stream";
import { AbbacchioClient, type AbbacchioClientOptions } from "../client.js";

export interface BunyanStreamOptions extends AbbacchioClientOptions {
  /** Bunyan log level (optional) */
  level?: number | string;
}

/**
 * Bunyan stream for Abbacchio.
 * Implements the Node.js Writable stream interface for Bunyan.
 *
 * @example
 * ```typescript
 * import bunyan from "bunyan";
 * import { bunyanStream } from "@abbacchio/client/transports/bunyan";
 *
 * const logger = bunyan.createLogger({
 *   name: "myapp",
 *   streams: [
 *     { stream: process.stdout },
 *     bunyanStream({
 *       url: "http://localhost:4000/api/logs",
 *       channel: "my-app",
 *       secretKey: "optional-encryption-key",
 *     }),
 *   ],
 * });
 *
 * logger.info("Hello from Bunyan!");
 * ```
 */
export class AbbacchioBunyanStream extends Writable {
  private client: AbbacchioClient;
  public level?: number | string;

  constructor(opts: BunyanStreamOptions = {}) {
    super({ objectMode: true });
    this.client = new AbbacchioClient(opts);
    this.level = opts.level;
  }

  /**
   * Writable stream _write method - called for each log entry
   */
  _write(
    chunk: Record<string, unknown>,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    try {
      // Transform Bunyan format to Abbacchio format
      const log = this.transformLog(chunk);
      this.client.add(log);
      callback();
    } catch (err) {
      callback(err as Error);
    }
  }

  /**
   * Transform Bunyan log format to a normalized format
   */
  private transformLog(record: Record<string, unknown>): Record<string, unknown> {
    const { name, hostname, pid, level, msg, time, v, ...rest } = record;

    return {
      level: level as number,
      msg,
      time: time ? new Date(time as string).getTime() : Date.now(),
      name,
      hostname,
      pid,
      ...rest,
    };
  }

  /**
   * Close the stream
   */
  _final(callback: (error?: Error | null) => void): void {
    this.client.close().then(() => callback()).catch(callback);
  }
}

/**
 * Factory function to create a Bunyan stream
 * Returns an object with stream and optional level for Bunyan's streams array
 */
export function bunyanStream(opts?: BunyanStreamOptions): { stream: AbbacchioBunyanStream; level?: number | string; type: "raw" } {
  const stream = new AbbacchioBunyanStream(opts);
  return {
    stream,
    level: opts?.level,
    type: "raw",
  };
}

export default bunyanStream;
