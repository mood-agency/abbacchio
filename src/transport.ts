import build from "pino-abstract-transport";
import { encrypt } from "./lib/crypto.js";

interface TransportOptions {
  url?: string;
  batchSize?: number;
  interval?: number;
  headers?: Record<string, string>;
  /** Secret key for encryption. If provided, logs will be encrypted before sending */
  secretKey?: string;
  /** Channel/app name for multi-app support. Defaults to 'default' */
  channel?: string;
}

export default async function (opts: TransportOptions) {
  const url = opts.url || "http://localhost:4000/api/logs";
  const batchSize = opts.batchSize || 10;
  const interval = opts.interval || 1000;
  const headers = opts.headers || {};
  const secretKey = opts.secretKey;
  const channel = opts.channel;

  let batch: unknown[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Encrypt a log entry if secretKey is provided
   */
  function processLog(log: unknown): unknown {
    if (secretKey) {
      return { encrypted: encrypt(JSON.stringify(log), secretKey) };
    }
    return log;
  }

  async function flush() {
    if (batch.length === 0) return;

    const toSend = batch;
    batch = [];

    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Encrypted": secretKey ? "true" : "false",
          ...(channel ? { "X-Channel": channel } : {}),
          ...headers,
        },
        body: JSON.stringify({ logs: toSend }),
      });
    } catch (err) {
      // Silently fail - don't break the app if pino-live is down
      // Optionally log to stderr for debugging
      // console.error('[pino-live] Failed to send logs:', err);
    }
  }

  function scheduleSend() {
    if (timer) return;
    timer = setTimeout(async () => {
      timer = null;
      await flush();
    }, interval);
  }

  return build(
    async function (source) {
      for await (const obj of source) {
        batch.push(processLog(obj));

        if (batch.length >= batchSize) {
          await flush();
        } else {
          scheduleSend();
        }
      }

      // Flush remaining on close
      await flush();
    },
    {
      async close() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        await flush();
      },
    }
  );
}
