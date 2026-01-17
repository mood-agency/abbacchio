#!/usr/bin/env npx tsx
/**
 * Script to insert test logs into abbacchio using bunyan transport
 *
 * Usage: npx tsx scripts/js/insert-test-logs-bunyan.ts [options]
 *   --count <n>       Number of logs per channel (default: 5)
 *   --delay <ms>      Delay between logs in ms (default: 100)
 *   --key <key>       Encryption key (optional)
 *   --name <name>     Log name/namespace (default: random)
 *   --channel <name>  Channel name(s), comma-separated (default: optimus,bumblebee,jazz)
 */

import bunyan from 'bunyan';
import { bunyanStream } from '../../packages/transport/dist/transports/bunyan.js';
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

// Map our level names to bunyan levels
const levelMap: Record<string, number> = {
  trace: bunyan.TRACE,
  debug: bunyan.DEBUG,
  info: bunyan.INFO,
  warn: bunyan.WARN,
  error: bunyan.ERROR,
  fatal: bunyan.FATAL,
};

function createLogger(channel: string, name: string, secretKey?: string): bunyan {
  return bunyan.createLogger({
    name,
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

function logWithLevel(
  logger: bunyan,
  level: string,
  message: string,
  extras: Record<string, unknown>
) {
  const bunyanLevel = levelMap[level] || bunyan.INFO;

  switch (bunyanLevel) {
    case bunyan.TRACE:
      logger.trace(extras, message);
      break;
    case bunyan.DEBUG:
      logger.debug(extras, message);
      break;
    case bunyan.INFO:
      logger.info(extras, message);
      break;
    case bunyan.WARN:
      logger.warn(extras, message);
      break;
    case bunyan.ERROR:
      logger.error(extras, message);
      break;
    case bunyan.FATAL:
      logger.fatal(extras, message);
      break;
  }
}

async function main() {
  const options = parseScriptArgs(defaultChannels);
  printConfig(options);

  // Create loggers for each channel
  const loggers = Object.fromEntries(
    options.channels.map((channel) => [
      channel,
      createLogger(channel, options.name || randomElement(namespaces), options.key),
    ])
  );

  for (let i = 0; i < options.count; i++) {
    for (const channel of options.channels) {
      const level = randomElement(levelNames);
      const message = randomElement(messages);
      const extras = generateRandomExtras(level);

      logWithLevel(loggers[channel], level, message, extras);
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
