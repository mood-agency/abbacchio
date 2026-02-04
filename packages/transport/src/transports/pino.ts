import build from "pino-abstract-transport";
import { AbbacchioClient, type AbbacchioClientOptions } from "../client.js";
import { Transform } from "stream";

export interface PinoTransportOptions extends AbbacchioClientOptions {}

export interface AbbacchioPinoStream extends Transform {
  /** Change the channel dynamically */
  setChannel(channel: string | undefined): void;
  /** Get the current channel */
  getChannel(): string | undefined;
  /** Change the namespace dynamically */
  setNamespace(namespace: string | undefined): void;
  /** Get the current namespace */
  getNamespace(): string | undefined;
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
 * Pino transport for Abbacchio.
 *
 * @example
 * ```typescript
 * import pino from "pino";
 *
 * const logger = pino({
 *   transport: {
 *     target: "@abbacchio/client/transports/pino",
 *     options: {
 *       url: "http://localhost:4000/api/logs",
 *       channel: "my-app",
 *       namespace: "auth-service",
 *       secretKey: "optional-encryption-key",
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
      // Flush remaining on close
      await client.flush();
    },
    {
      async close() {
        await client.close();
      },
    }
  );
}

/**
 * Named export for programmatic usage
 */
export { pinoTransport };

/**
 * Create a Pino destination stream with direct access to the client.
 * Use this when you need to change the channel dynamically.
 *
 * @example
 * ```typescript
 * import pino from "pino";
 * import { createPinoStream } from "@abbacchio/transport/transports/pino";
 *
 * const stream = createPinoStream({
 *   url: "http://localhost:4000/api/logs",
 *   channel: "initial-channel",
 * });
 *
 * const logger = pino(stream);
 *
 * logger.info("Log to initial channel");
 *
 * // Change channel dynamically
 * stream.setChannel("new-channel");
 *
 * logger.info("Log to new channel");
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

  stream.setChannel = (channel: string | undefined) => {
    client.setChannel(channel);
  };

  stream.getChannel = () => {
    return client.getChannel();
  };

  stream.setNamespace = (namespace: string | undefined) => {
    client.setNamespace(namespace);
  };

  stream.getNamespace = () => {
    return client.getNamespace();
  };

  stream.enable = () => {
    client.enable();
  };

  stream.disable = () => {
    client.disable();
  };

  stream.isEnabled = () => {
    return client.isEnabled();
  };

  stream.close = async () => {
    await client.close();
  };

  return stream;
}
