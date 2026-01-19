/**
 * @abbacchio/browser-transport - Browser and React logging client for Abbacchio
 *
 * @example Basic usage
 * ```typescript
 * import { createLogger } from '@abbacchio/browser-transport'
 *
 * const log = createLogger({
 *   url: 'http://localhost:4000/api/logs',
 *   channel: 'my-app',
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
 *   url: 'http://localhost:4000/api/logs',
 *   channel: 'my-app',
 * })
 *
 * // Now all console.log calls go to Abbacchio
 * console.log('This goes to Abbacchio!')
 * ```
 *
 * @example React usage
 * ```tsx
 * import { AbbacchioProvider, useLogger } from '@abbacchio/browser-transport/react'
 *
 * function App() {
 *   return (
 *     <AbbacchioProvider channel="my-app" captureConsole>
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
export { AbbacchioClient, createClient, type AbbacchioClientOptions, type LogEntry } from './client.js';

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

// Crypto utilities
export { encrypt, decrypt, generateKey, isCryptoAvailable } from './crypto.js';
