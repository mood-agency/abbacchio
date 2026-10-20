/**
 * Auto-initialize console interception (OTLP native)
 *
 * Simply import this module to start capturing console output:
 *
 * @example
 * ```typescript
 * import '@abbacchio/browser-transport/auto'
 *
 * // All console.log calls now go to Abbacchio via OTLP
 * console.log('This is captured!')
 * ```
 *
 * Configuration can be done via window.__ABBACCHIO_CONFIG__:
 *
 * @example
 * ```html
 * <script>
 *   window.__ABBACCHIO_CONFIG__ = {
 *     endpoint: 'http://localhost:4000',
 *     serviceName: 'my-app',
 *     appName: 'my-web-app',
 *   }
 * </script>
 * <script type="module">
 *   import '@abbacchio/browser-transport/auto'
 * </script>
 * ```
 */

import { interceptConsole, type ConsoleInterceptorOptions } from './console.js';

declare global {
  interface Window {
    __ABBACCHIO_CONFIG__?: ConsoleInterceptorOptions;
  }
}

const config: ConsoleInterceptorOptions =
  (typeof window !== 'undefined' && window.__ABBACCHIO_CONFIG__) || {};

interceptConsole({
  endpoint: 'http://localhost:4000',
  serviceName: 'browser',
  appName: 'auto',
  ...config,
});
