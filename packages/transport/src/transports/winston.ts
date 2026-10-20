import TransportStream from "winston-transport";
import { AbbacchioClient, type AbbacchioClientOptions } from "../client.js";

export interface WinstonTransportOptions extends AbbacchioClientOptions {
  /** Winston log level (optional) */
  level?: string;
}

/**
 * Winston transport for Abbacchio (OTLP native).
 *
 * @example
 * ```typescript
 * import winston from "winston";
 * import { AbbacchioWinstonTransport } from "@abbacchio/transport/transports/winston";
 *
 * const logger = winston.createLogger({
 *   transports: [
 *     new winston.transports.Console(),
 *     new AbbacchioWinstonTransport({
 *       endpoint: "http://localhost:4000",
 *       serviceName: "my-app",
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

  log(info: Record<string, unknown>, callback: () => void): void {
    setImmediate(() => {
      this.emit("logged", info);
    });

    const log = this.transformLog(info);
    this.client.add(log);
    callback();
  }

  private transformLog(info: Record<string, unknown>): Record<string, unknown> {
    const { level, message, timestamp, ...rest } = info;

    return {
      level: this.levelToNumber(level as string),
      msg: message,
      time: timestamp ? new Date(timestamp as string).getTime() : Date.now(),
      ...rest,
    };
  }

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

  setServiceName(name: string): void { this.client.setServiceName(name); }
  getServiceName(): string { return this.client.getServiceName(); }
  enable(): void { this.client.enable(); }
  disable(): void { this.client.disable(); }
  isEnabled(): boolean { return this.client.isEnabled(); }

  close(): void {
    this.client.close();
  }
}

export function winstonTransport(opts?: WinstonTransportOptions): AbbacchioWinstonTransport {
  return new AbbacchioWinstonTransport(opts);
}

export default winstonTransport;
