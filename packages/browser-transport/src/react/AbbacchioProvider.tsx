/**
 * React Context Provider for Abbacchio
 * Provides logging functionality to React components via context
 */

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Logger, createLogger, type LoggerOptions } from '../logger.js';
import { interceptConsole, stopInterceptConsole, type ConsoleInterceptorOptions } from '../console.js';

export interface AbbacchioContextValue {
  /** Logger instance for structured logging */
  logger: Logger;
  /** Log at info level */
  info: Logger['info'];
  /** Log at warn level */
  warn: Logger['warn'];
  /** Log at error level */
  error: Logger['error'];
  /** Log at debug level */
  debug: Logger['debug'];
  /** Create a child logger with additional bindings */
  child: Logger['child'];
}

const AbbacchioContext = createContext<AbbacchioContextValue | null>(null);

export interface AbbacchioProviderProps extends LoggerOptions {
  children: ReactNode;
  /** Whether to intercept console.log/warn/error/etc. Defaults to false */
  captureConsole?: boolean;
  /** Options for console capture (only used if captureConsole is true) */
  consoleOptions?: Omit<ConsoleInterceptorOptions, keyof LoggerOptions>;
}

/**
 * Provider component that makes logging available to all child components
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <AbbacchioProvider
 *       url="http://localhost:4000/api/logs"
 *       channel="my-react-app"
 *       captureConsole
 *     >
 *       <MyApp />
 *     </AbbacchioProvider>
 *   )
 * }
 * ```
 */
export function AbbacchioProvider({
  children,
  captureConsole = false,
  consoleOptions,
  ...loggerOptions
}: AbbacchioProviderProps) {
  // Create logger instance
  const logger = useMemo(() => createLogger(loggerOptions), [
    loggerOptions.url,
    loggerOptions.channel,
    loggerOptions.secretKey,
    loggerOptions.name,
    loggerOptions.level,
    loggerOptions.batchSize,
    loggerOptions.flushInterval,
  ]);

  // Setup console interception if enabled
  useEffect(() => {
    if (captureConsole) {
      interceptConsole({
        ...loggerOptions,
        ...consoleOptions,
        appName: consoleOptions?.appName || loggerOptions.name,
      });

      return () => {
        stopInterceptConsole();
      };
    }
  }, [captureConsole, loggerOptions, consoleOptions]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      logger.close();
    };
  }, [logger]);

  // Create context value with bound methods
  const value = useMemo<AbbacchioContextValue>(() => ({
    logger,
    info: logger.info.bind(logger),
    warn: logger.warn.bind(logger),
    error: logger.error.bind(logger),
    debug: logger.debug.bind(logger),
    child: logger.child.bind(logger),
  }), [logger]);

  return (
    <AbbacchioContext.Provider value={value}>
      {children}
    </AbbacchioContext.Provider>
  );
}

/**
 * Hook to access the Abbacchio logger from any component
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { info, error } = useAbbacchio()
 *
 *   const handleClick = () => {
 *     info('Button clicked', { component: 'MyComponent' })
 *   }
 *
 *   return <button onClick={handleClick}>Click me</button>
 * }
 * ```
 */
export function useAbbacchio(): AbbacchioContextValue {
  const context = useContext(AbbacchioContext);
  if (!context) {
    throw new Error('useAbbacchio must be used within an AbbacchioProvider');
  }
  return context;
}

/**
 * Hook to get just the logger instance
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const log = useLogger()
 *
 *   useEffect(() => {
 *     log.info('Component mounted')
 *     return () => log.info('Component unmounted')
 *   }, [log])
 *
 *   return <div>Hello</div>
 * }
 * ```
 */
export function useLogger(): Logger {
  const { logger } = useAbbacchio();
  return logger;
}
