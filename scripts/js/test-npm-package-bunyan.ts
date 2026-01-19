#!/usr/bin/env npx tsx
/**
 * Test @abbacchio/transport bunyan integration from npm
 *
 * First install the package: npm install -g @abbacchio/transport bunyan
 * Or in any directory: npm install @abbacchio/transport bunyan
 *
 * Usage: npx tsx scripts/js/test-npm-package-bunyan.ts [options]
 *   --count <n>       Number of logs per channel (default: 5)
 *   --delay <ms>      Delay between logs in ms (default: 100)
 *   --key <key>       Encryption key (optional)
 *   --name <name>     Log name/namespace (default: random)
 *   --channel <name>  Channel name(s), comma-separated (default: npm-test-bunyan)
 */

import bunyan from 'bunyan';
// @ts-expect-error - resolved by pnpm workspace
import { bunyanStream } from '@abbacchio/transport/transports/bunyan';
import {
  API_URL,
  namespaces,
  levelNames,
  messages,
  parseScriptArgs,
  printConfig,
  randomElement,
  sleep,
} from './test-utils';

const extras = [
  { userId: 'user_001', requestId: 'req_abc123' },
  { userId: 'user_002', duration: 150 },
  { requestId: 'req_xyz789', metadata: { env: 'test' } },
  { error: { message: 'Test error', code: 'ERR_TEST' } },
];

function createLogger(channel: string, loggerName: string, secretKey?: string) {
  return bunyan.createLogger({
    name: loggerName,
    streams: [
      { stream: process.stdout, level: 'trace' },
      bunyanStream({
        url: API_URL,
        channel,
        ...(secretKey ? { secretKey } : {}),
        level: 'trace',
      }),
    ],
  });
}

function logWithLevel(logger: bunyan, level: string, message: string, extraData: Record<string, unknown>) {
  switch (level) {
    case 'trace':
      logger.trace(extraData, message);
      break;
    case 'debug':
      logger.debug(extraData, message);
      break;
    case 'info':
      logger.info(extraData, message);
      break;
    case 'warn':
      logger.warn(extraData, message);
      break;
    case 'error':
      logger.error(extraData, message);
      break;
    case 'fatal':
      logger.fatal(extraData, message);
      break;
    default:
      logger.info(extraData, message);
  }
}

async function main() {
  const options = parseScriptArgs(['npm-test-bunyan']);
  printConfig(options);

  console.log('Creating loggers for channels:', options.channels.join(', '));

  const loggers = Object.fromEntries(
    options.channels.map(channel => [
      channel,
      createLogger(channel, options.name || randomElement(namespaces), options.key)
    ])
  );

  for (let i = 0; i < options.count; i++) {
    for (const channel of options.channels) {
      const level = randomElement(levelNames);
      const message = randomElement(messages);
      const extraData = { ...randomElement(extras) };

      logWithLevel(loggers[channel], level, message, extraData);
      console.log(`[${channel}] Sent log #${i + 1} (level: ${level})`);

      if (options.delay > 0) {
        await sleep(options.delay);
      }
    }
  }

  // Wait for transport to flush
  await sleep(2000);
  console.log('\nDone!');
}

main().catch(console.error);
