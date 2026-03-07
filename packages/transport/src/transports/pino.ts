import build from "pino-abstract-transport";
import { AbbacchioClient, type AbbacchioClientOptions } from "../client.js";
import { Transform } from "stream";

export interface PinoTransportOptions extends AbbacchioClientOptions {}

export interface AbbacchioPinoStream extends Transform {
  /** Change the service name dynamically */
  setServiceName(name: string): void;
  /** Get the current service name */
  getServiceName(): string;
  /** Enable sending logs to the server */
  enable(): void;
  /** Disable sending logs to the server */
  disable(): void;
  /** Check if the client is currently enabled */
  isEnabled(): boolean;
  /** Flush pending logs and close the client */
  close(): Promise<void>;
}

/**
 * Pino transport for Abbacchio (OTLP native).
 *
 * @example
 * ```typescript
 * import pino from "pino";
 *
 * const logger = pino({
 *   transport: {
 *     target: "@abbacchio/transport/pino",
 *     options: {
 *       endpoint: "http://localhost:4002",
 *       serviceName: "my-app",
 *     },
 *   },
 * });
 *
 * logger.info("Hello from Pino!");
 * ```
 */
export default async function pinoTransport(opts: PinoTransportOptions = {}) {
  const client = new AbbacchioClient(opts);

  return build(
    async function (source) {
      for await (const obj of source) {
        client.add(obj);
      }
      await client.flush();
    },
    {
      async close() {
        await client.close();
      },
    }
  );
}

export { pinoTransport };

/**
 * Create a Pino destination stream with direct access to the client.
 *
 * @example
 * ```typescript
 * import pino from "pino";
 * import { createPinoStream } from "@abbacchio/transport/transports/pino";
 *
 * const stream = createPinoStream({
 *   endpoint: "http://localhost:4002",
 *   serviceName: "my-app",
 * });
 *
 * const logger = pino(stream);
 * logger.info("Log to OTLP");
 *
 * stream.setServiceName("other-service");
 * logger.info("Log with different service name");
 * ```
 */
export function createPinoStream(opts: PinoTransportOptions = {}): AbbacchioPinoStream {
  const client = new AbbacchioClient(opts);

  const stream = new Transform({
    objectMode: true,
    transform(chunk, _encoding, callback) {
      try {
        const log = typeof chunk === "string" ? JSON.parse(chunk) : chunk;
        client.add(log);
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
    flush(callback) {
      client.flush().then(() => callback()).catch(callback);
    },
  }) as AbbacchioPinoStream;

  stream.setServiceName = (name: string) => client.setServiceName(name);
  stream.getServiceName = () => client.getServiceName();
  stream.enable = () => client.enable();
  stream.disable = () => client.disable();
  stream.isEnabled = () => client.isEnabled();
  stream.close = async () => { await client.close(); };

  return stream;
}
