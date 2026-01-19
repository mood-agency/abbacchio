/**
 * Auto-initialize console interception
 *
 * Simply import this module to start capturing console output:
 *
 * @example
 * ```typescript
 * import '@abbacchio/browser-transport/auto'
 *
 * // All console.log calls now go to Abbacchio
 * console.log('This is captured!')
 * ```
 *
 * Configuration can be done via window.__ABBACCHIO_CONFIG__:
 *
 * @example
 * ```html
 * <script>
 *   window.__ABBACCHIO_CONFIG__ = {
 *     url: 'http://localhost:4000/api/logs',
 *     channel: 'my-app',
 *     appName: 'my-web-app',
 *     secretKey: 'optional-encryption-key',
 *   }
 * </script>
 * <script type="module">
 *   import '@abbacchio/browser-transport/auto'
 * </script>
 * ```
 */

import { interceptConsole, type ConsoleInterceptorOptions } from './console.js';

// Extend Window interface for TypeScript
declare global {
  interface Window {
    __ABBACCHIO_CONFIG__?: ConsoleInterceptorOptions;
  }
}

// Get configuration from global variable or use defaults
const config: ConsoleInterceptorOptions =
  (typeof window !== 'undefined' && window.__ABBACCHIO_CONFIG__) || {};

// Start intercepting with merged config
interceptConsole({
  url: 'http://localhost:4000/api/logs',
  channel: 'browser',
  appName: 'auto',
  ...config,
});
