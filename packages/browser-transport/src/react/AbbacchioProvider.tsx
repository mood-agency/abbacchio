/**
 * React Context Provider for Abbacchio (OTLP native)
 * Provides logging functionality to React components via context
 */

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Logger, createLogger, type LoggerOptions } from '../logger.js';
import { interceptConsole, stopInterceptConsole, type ConsoleInterceptorOptions } from '../console.js';
import type { WebVitalsCaptureOptions } from '../web-vitals.js';

export interface AbbacchioContextValue {
  logger: Logger;
  info: Logger['info'];
  warn: Logger['warn'];
  error: Logger['error'];
  debug: Logger['debug'];
  child: Logger['child'];
  metric: Logger['metric'];
  startSpan: Logger['startSpan'];
}

const AbbacchioContext = createContext<AbbacchioContextValue | null>(null);

export interface AbbacchioProviderProps extends LoggerOptions {
  children: ReactNode;
  /** Whether to intercept console.log/warn/error/etc. Defaults to false */
  captureConsole?: boolean;
  /** Options for console capture (only used if captureConsole is true) */
  consoleOptions?: Omit<ConsoleInterceptorOptions, keyof LoggerOptions>;
  /** Options for Web Vitals capture (only used if captureWebVitals is true in LoggerOptions) */
  webVitalsOptions?: Omit<WebVitalsCaptureOptions, 'appName' | 'includeUrl'>;
}

/**
 * Provider component that makes logging available to all child components
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <AbbacchioProvider
 *       endpoint="http://localhost:4000"
 *       serviceName="my-react-app"
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
  webVitalsOptions,
  ...loggerOptions
}: AbbacchioProviderProps) {
  const logger = useMemo(() => createLogger({
    ...loggerOptions,
    webVitalsOptions,
  }), [
    loggerOptions.endpoint,
    loggerOptions.serviceName,
    loggerOptions.name,
    loggerOptions.level,
    loggerOptions.batchSize,
    loggerOptions.flushInterval,
    loggerOptions.captureWebVitals,
  ]);

  // loggerOptions/consoleOptions are fresh objects every render, so key the
  // effect on their contents; depending on identity would tear down and rebuild
  // the console client (and its unload listeners) on every parent re-render.
  const consoleConfigKey = JSON.stringify(
    { loggerOptions, consoleOptions },
    (_key, val) => (val instanceof RegExp ? val.toString() : val),
  );

  useEffect(() => {
    if (captureConsole) {
      interceptConsole({
        ...loggerOptions,
        ...consoleOptions,
        appName: consoleOptions?.appName || loggerOptions.name,
      });

      return () => { stopInterceptConsole(); };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureConsole, consoleConfigKey]);

  useEffect(() => {
    return () => { logger.close(); };
  }, [logger]);

  const value = useMemo<AbbacchioContextValue>(() => ({
    logger,
    info: logger.info.bind(logger),
    warn: logger.warn.bind(logger),
    error: logger.error.bind(logger),
    debug: logger.debug.bind(logger),
    child: logger.child.bind(logger),
    metric: logger.metric.bind(logger),
    startSpan: logger.startSpan.bind(logger),
  }), [logger]);

  return (
    <AbbacchioContext.Provider value={value}>
      {children}
    </AbbacchioContext.Provider>
  );
}

export function useAbbacchio(): AbbacchioContextValue {
  const context = useContext(AbbacchioContext);
  if (!context) {
    throw new Error('useAbbacchio must be used within an AbbacchioProvider');
  }
  return context;
}

export function useLogger(): Logger {
  const { logger } = useAbbacchio();
  return logger;
}
