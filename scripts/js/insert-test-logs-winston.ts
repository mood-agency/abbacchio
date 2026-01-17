#!/usr/bin/env npx tsx
/**
 * Script to insert test logs into abbacchio using winston transport
 *
 * Usage: npx tsx scripts/js/insert-test-logs-winston.ts [options]
 *   --count <n>       Number of logs per channel (default: 5)
 *   --delay <ms>      Delay between logs in ms (default: 100)
 *   --key <key>       Encryption key (optional)
 *   --name <name>     Log name/namespace (default: random)
 *   --channel <name>  Channel name(s), comma-separated (default: optimus,bumblebee,jazz)
 */

import winston from 'winston';
import { AbbacchioWinstonTransport } from '../../packages/transport/dist/transports/winston.js';
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

// Map our level names to winston levels
const levelMap: Record<string, string> = {
  trace: 'silly',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'error', // Winston doesn't have fatal, use error
};

function createLogger(channel: string, secretKey?: string): winston.Logger {
  return winston.createLogger({
    level: 'silly', // Enable all levels
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        ),
      }),
      new AbbacchioWinstonTransport({
        url: API_URL,
        channel,
        ...(secretKey ? { secretKey } : {}),
      }),
    ],
  });
}

function logWithLevel(
  logger: winston.Logger,
  level: string,
  message: string,
  extras: Record<string, unknown>,
  name?: string
) {
  const winstonLevel = levelMap[level] || 'info';
  const logData = { ...extras, namespace: name || randomElement(namespaces) };

  logger.log(winstonLevel, message, logData);
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

  // Close all loggers
  for (const logger of Object.values(loggers)) {
    logger.close();
  }

  console.log('\nDone!');
}

main().catch(console.error);
