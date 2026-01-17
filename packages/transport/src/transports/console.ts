import { AbbacchioClient, type AbbacchioClientOptions } from "../client.js";

export interface ConsoleInterceptorOptions extends AbbacchioClientOptions {
  /** Which console methods to intercept. Defaults to all. */
  methods?: ("log" | "info" | "warn" | "error" | "debug")[];
  /** Whether to still output to original console. Defaults to true. */
  passthrough?: boolean;
}

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";

const methodToLevel: Record<ConsoleMethod, number> = {
  debug: 20,
  log: 30,
  info: 30,
  warn: 40,
  error: 50,
};

/**
 * Console interceptor for Abbacchio.
 * Intercepts console.log/info/warn/error/debug calls and sends them to Abbacchio.
 *
 * @example
 * ```typescript
 * import { interceptConsole, restoreConsole } from "@abbacchio/client/transports/console";
 *
 * // Start intercepting console calls
 * interceptConsole({
 *   url: "http://localhost:4000/api/logs",
 *   channel: "my-app",
 *   secretKey: "optional-encryption-key",
 *   passthrough: true, // Still log to console
 * });
 *
 * console.log("This will be sent to Abbacchio!");
 * console.error("Errors too!");
 *
 * // Stop intercepting when done
 * restoreConsole();
 * ```
 */

// Store original console methods
const originalConsole: Record<ConsoleMethod, (...args: unknown[]) => void> = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

let activeClient: AbbacchioClient | null = null;
let activeOptions: ConsoleInterceptorOptions | null = null;

/**
 * Format console arguments into a message string
 */
function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

/**
 * Create an intercepted console method
 */
function createInterceptedMethod(
  method: ConsoleMethod,
  client: AbbacchioClient,
  passthrough: boolean
): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    // Send to Abbacchio
    const log = {
      level: methodToLevel[method],
      msg: formatArgs(args),
      time: Date.now(),
      method,
    };
    client.add(log);

    // Optionally pass through to original console
    if (passthrough) {
      originalConsole[method](...args);
    }
  };
}

/**
 * Start intercepting console calls
 */
export function interceptConsole(opts: ConsoleInterceptorOptions = {}): void {
  // Restore any existing interception first
  if (activeClient) {
    restoreConsole();
  }

  const methods = opts.methods || ["log", "info", "warn", "error", "debug"];
  const passthrough = opts.passthrough !== false;

  activeClient = new AbbacchioClient(opts);
  activeOptions = opts;

  // Replace console methods
  for (const method of methods) {
    (console as unknown as Record<string, unknown>)[method] = createInterceptedMethod(
      method,
      activeClient,
      passthrough
    );
  }
}

/**
 * Stop intercepting console calls and restore original behavior
 */
export function restoreConsole(): void {
  // Restore original console methods
  for (const method of Object.keys(originalConsole) as ConsoleMethod[]) {
    (console as unknown as Record<string, unknown>)[method] = originalConsole[method];
  }

  // Flush and close client
  if (activeClient) {
    activeClient.close();
    activeClient = null;
    activeOptions = null;
  }
}

/**
 * Get the active client (for testing)
 */
export function getActiveClient(): AbbacchioClient | null {
  return activeClient;
}

export default interceptConsole;
