import TransportStream from "winston-transport";
import { AbbacchioClient, type AbbacchioClientOptions } from "../client.js";

export interface WinstonTransportOptions extends AbbacchioClientOptions {
  /** Winston log level (optional) */
  level?: string;
}

/**
 * Winston transport for Abbacchio.
 * Extends winston-transport for proper integration.
 *
 * @example
 * ```typescript
 * import winston from "winston";
 * import { AbbacchioWinstonTransport } from "@abbacchio/client/transports/winston";
 *
 * const logger = winston.createLogger({
 *   transports: [
 *     new winston.transports.Console(),
 *     new AbbacchioWinstonTransport({
 *       url: "http://localhost:4000/api/logs",
 *       channel: "my-app",
 *       secretKey: "optional-encryption-key",
 *     }),
 *   ],
 * });
 *
 * logger.info("Hello from Winston!");
 * ```
 */
export class AbbacchioWinstonTransport extends TransportStream {
  private client: AbbacchioClient;

  constructor(opts: WinstonTransportOptions = {}) {
    super({ level: opts.level });
    this.client = new AbbacchioClient(opts);
  }

  /**
   * Winston log method - called for each log entry
   */
  log(info: Record<string, unknown>, callback: () => void): void {
    setImmediate(() => {
      this.emit("logged", info);
    });

    // Transform Winston format to Abbacchio format
    const log = this.transformLog(info);
    this.client.add(log);

    callback();
  }

  /**
   * Transform Winston log format to a normalized format
   */
  private transformLog(info: Record<string, unknown>): Record<string, unknown> {
    const { level, message, timestamp, ...rest } = info;

    return {
      level: this.levelToNumber(level as string),
      msg: message,
      time: timestamp ? new Date(timestamp as string).getTime() : Date.now(),
      ...rest,
    };
  }

  /**
   * Convert Winston level string to Pino-style number
   */
  private levelToNumber(level: string): number {
    const levels: Record<string, number> = {
      error: 50,
      warn: 40,
      info: 30,
      http: 30,
      verbose: 20,
      debug: 20,
      silly: 10,
    };
    return levels[level] || 30;
  }

  /**
   * Close the transport
   */
  close(): void {
    this.client.close();
  }
}

/**
 * Factory function to create a Winston transport
 */
export function winstonTransport(opts?: WinstonTransportOptions): AbbacchioWinstonTransport {
  return new AbbacchioWinstonTransport(opts);
}

export default winstonTransport;
