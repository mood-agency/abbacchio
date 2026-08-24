/**
 * @abbacchio/browser-transport - Browser and React logging client for Abbacchio (OTLP native)
 *
 * @example Basic usage
 * ```typescript
 * import { createLogger } from '@abbacchio/browser-transport'
 *
 * const log = createLogger({
 *   endpoint: 'http://localhost:4002',
 *   serviceName: 'my-app',
 * })
 *
 * log.info('Hello from browser!')
 * log.error('Something went wrong', { error: 'details' })
 * ```
 *
 * @example Intercept console.log
 * ```typescript
 * import { interceptConsole } from '@abbacchio/browser-transport'
 *
 * interceptConsole({
 *   endpoint: 'http://localhost:4002',
 *   serviceName: 'my-app',
 * })
 *
 * // Now all console.log calls go to Abbacchio via OTLP
 * console.log('This goes to Abbacchio!')
 * ```
 *
 * @example React usage
 * ```tsx
 * import { AbbacchioProvider, useLogger } from '@abbacchio/browser-transport/react'
 *
 * function App() {
 *   return (
 *     <AbbacchioProvider endpoint="http://localhost:4002" serviceName="my-app" captureConsole>
 *       <MyApp />
 *     </AbbacchioProvider>
 *   )
 * }
 *
 * function MyComponent() {
 *   const log = useLogger()
 *   return <button onClick={() => log.info('clicked')}>Click</button>
 * }
 * ```
 */

// Client
export { AbbacchioClient, createClient, type AbbacchioClientOptions, type LogEntry, type MetricRecord, type SpanRecord } from './client.js';

// Logger
export { Logger, createLogger, LOG_LEVELS, type LoggerOptions } from './logger.js';

// Console interceptor
export {
  interceptConsole,
  stopInterceptConsole,
  flushConsole,
  isConsoleIntercepted,
  getOriginalConsole,
  type ConsoleInterceptorOptions,
} from './console.js';

// Error capture
export { startErrorCapture, stopErrorCapture, type ErrorCaptureOptions } from './errors.js';

// Performance capture (longtask + slow events)
export { startPerfCapture, stopPerfCapture, type PerfCaptureOptions } from './perf.js';

// Opt-in, bounded browser memory profiling
export {
  MemoryProfiler,
  collectMemoryProfilerSample,
  installMemoryProfiler,
  serializeMemoryProfilerSamples,
  toMemoryProfilerMetrics,
  type InstallMemoryProfilerOptions,
  type MemoryDomSample,
  type MemoryHeapSample,
  type MemoryProfilerApi,
  type MemoryProfilerMetric,
  type MemoryProfilerMetricOptions,
  type MemoryProfilerOptions,
  type MemoryProfilerSample,
  type MemoryProfilerSampleContext,
  type MemoryProfilerStartOptions,
  type MemoryProfilerStatus,
  type MemoryProfilerValues,
} from './memory-profiler.js';

// Web Vitals (LCP, INP, CLS, FCP, TTFB)
export { startWebVitalsCapture, stopWebVitalsCapture, type WebVitalsCaptureOptions } from './web-vitals.js';

// Network capture
export { startNetworkCapture, stopNetworkCapture, type NetworkCaptureOptions } from './network.js';
