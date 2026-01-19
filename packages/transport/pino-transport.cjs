'use strict'

/**
 * CommonJS wrapper for the Pino transport.
 *
 * Pino runs transports in worker threads using require(), which doesn't
 * work well with ESM subpath exports. This CJS wrapper allows users to
 * simply use: target: '@abbacchio/transport'
 *
 * @example
 * ```javascript
 * const pino = require('pino');
 *
 * const logger = pino({
 *   transport: {
 *     target: '@abbacchio/transport',
 *     options: {
 *       url: 'http://localhost:4000/api/logs',
 *       channel: 'my-app',
 *     },
 *   },
 * });
 * ```
 */

// Dynamic import the ESM module
module.exports = async function(opts) {
  const { default: pinoTransport } = await import('./dist/transports/pino.js');
  return pinoTransport(opts);
};
