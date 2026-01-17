#!/usr/bin/env npx tsx
/**
 * Script to insert test logs into abbacchio using pino transport
 *
 * Usage: npx tsx scripts/js/insert-test-logs-pino.ts [options]
 *   --count <n>       Number of logs per channel (default: 5)
 *   --delay <ms>      Delay between logs in ms (default: 100)
 *   --key <key>       Encryption key (optional)
 *   --name <name>     Log name/namespace (default: random)
 *   --channel <name>  Channel name(s), comma-separated (default: optimus,bumblebee,jazz)
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pino, { Logger } from 'pino';
import {
  API_URL,
  defaultChannels,
  namespaces,
  levelNames,
  messages,
  randomElement,
  generateRandomExtras,
  parseScriptArgs,
  printConfig,
  sleep,
} from './test-utils';

// Resolve path to transport for pino (pino needs file paths, not package exports)
const __dirname = dirname(fileURLToPath(import.meta.url));
const transportPath = join(__dirname, '../../packages/transport/dist/transports/pino.js');

function createLogger(channel: string, secretKey?: string): Logger {
  return pino({
    level: 'trace',
    transport: {
      target: transportPath,
      options: {
        url: API_URL,
        channel,
        ...(secretKey ? { secretKey } : {}),
      },
    },
  });
}

function logWithLevel(
  logger: Logger,
  level: string,
  message: string,
  extras: Record<string, unknown>,
  name?: string
) {
  const logData = { ...extras, name: name || randomElement(namespaces) };
  switch (level) {
    case 'trace':
      logger.trace(logData, message);
      break;
    case 'debug':
      logger.debug(logData, message);
      break;
    case 'info':
      logger.info(logData, message);
      break;
    case 'warn':
      logger.warn(logData, message);
      break;
    case 'error':
      logger.error(logData, message);
      break;
    case 'fatal':
      logger.fatal(logData, message);
      break;
  }
}

async function main() {
  const options = parseScriptArgs(defaultChannels);
  printConfig(options);

  // Create loggers for each channel
  const loggers = Object.fromEntries(
    options.channels.map((channel) => [channel, createLogger(channel, options.key)])
  );

  for (let i = 0; i < options.count; i++) {
    for (const channel of options.channels) {
      const level = randomElement(levelNames);
      const message = randomElement(messages);
      const extras = generateRandomExtras(level);

      logWithLevel(loggers[channel], level, message, extras, options.name);
      console.log(`[${channel}] Sent log #${i + 1} (level: ${level})`);

      if (options.delay > 0) {
        await sleep(options.delay);
      }
    }
  }

  // Wait for the transport to flush
  await sleep(2000);

  console.log('\nDone!');
}

main().catch(console.error);
