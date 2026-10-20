import { Writable } from "stream";
import { AbbacchioClient, type AbbacchioClientOptions } from "../client.js";

export interface BunyanStreamOptions extends AbbacchioClientOptions {
  /** Bunyan log level (optional) */
  level?: number | string;
}

/**
 * Bunyan stream for Abbacchio (OTLP native).
 *
 * @example
 * ```typescript
 * import bunyan from "bunyan";
 * import { bunyanStream } from "@abbacchio/transport/transports/bunyan";
 *
 * const logger = bunyan.createLogger({
 *   name: "myapp",
 *   streams: [
 *     { stream: process.stdout },
 *     bunyanStream({
 *       endpoint: "http://localhost:4000",
 *       serviceName: "my-app",
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

  _write(
    chunk: Record<string, unknown>,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    try {
      const log = this.transformLog(chunk);
      this.client.add(log);
      callback();
    } catch (err) {
      callback(err as Error);
    }
  }

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

  setServiceName(name: string): void { this.client.setServiceName(name); }
  getServiceName(): string { return this.client.getServiceName(); }
  enable(): void { this.client.enable(); }
  disable(): void { this.client.disable(); }
  isEnabled(): boolean { return this.client.isEnabled(); }

  _final(callback: (error?: Error | null) => void): void {
    this.client.close().then(() => callback()).catch(callback);
  }
}

export function bunyanStream(opts?: BunyanStreamOptions): { stream: AbbacchioBunyanStream; level?: number | string; type: "raw" } {
  const stream = new AbbacchioBunyanStream(opts);
  return {
    stream,
    level: opts?.level,
    type: "raw",
  };
}

export default bunyanStream;
