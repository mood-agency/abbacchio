import build from "pino-abstract-transport";
import { AbbacchioClient, type AbbacchioClientOptions } from "../client.js";

export interface PinoTransportOptions extends AbbacchioClientOptions {}

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
