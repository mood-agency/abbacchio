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

const originalConsole: Record<ConsoleMethod, (...args: unknown[]) => void> = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

let activeClient: AbbacchioClient | null = null;

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

function createInterceptedMethod(
  method: ConsoleMethod,
  client: AbbacchioClient,
  passthrough: boolean
): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    const log = {
      level: methodToLevel[method],
      msg: formatArgs(args),
      time: Date.now(),
      method,
    };
    client.add(log);

    if (passthrough) {
      originalConsole[method](...args);
    }
  };
}

/**
 * Start intercepting console calls and send them via OTLP.
 *
 * @example
 * ```typescript
 * import { interceptConsole, restoreConsole } from "@abbacchio/transport/transports/console";
 *
 * interceptConsole({
 *   endpoint: "http://localhost:4000",
 *   serviceName: "my-app",
 *   passthrough: true,
 * });
 *
 * console.log("This will be sent to Abbacchio via OTLP!");
 *
 * restoreConsole();
 * ```
 */
export function interceptConsole(opts: ConsoleInterceptorOptions = {}): void {
  if (activeClient) {
    restoreConsole();
  }

  const methods = opts.methods || ["log", "info", "warn", "error", "debug"];
  const passthrough = opts.passthrough !== false;

  activeClient = new AbbacchioClient(opts);

  for (const method of methods) {
    (console as unknown as Record<string, unknown>)[method] = createInterceptedMethod(
      method,
      activeClient,
      passthrough
    );
  }
}

export function restoreConsole(): void {
  for (const method of Object.keys(originalConsole) as ConsoleMethod[]) {
    (console as unknown as Record<string, unknown>)[method] = originalConsole[method];
  }

  if (activeClient) {
    activeClient.close();
    activeClient = null;
  }
}

export function getActiveClient(): AbbacchioClient | null {
  return activeClient;
}

export default interceptConsole;
