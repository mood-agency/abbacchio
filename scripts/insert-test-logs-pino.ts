#!/usr/bin/env npx tsx
/**
 * Script to insert test logs into abbacchio using pino transport
 * Sends random logs to 3 channels: optimus, bumblebee, jazz
 *
 * Usage: npx tsx scripts/insert-test-logs.ts [options]
 *   --count <n>       Number of logs per channel (default: 5)
 *   --delay <ms>      Delay between logs in ms (default: 100)
 *   --key <key>       Encryption key (optional)
 *   --name <name>     Log name/namespace (default: random)
 */

import pino, { Logger } from 'pino';
import { parseArgs } from 'util';

const API_URL = process.env.API_URL || 'http://localhost:4000/api/logs';

const channels = ['Moody Blues'] as const;

const namespaces = ['auth', 'api', 'db', 'cache', 'worker', 'scheduler'];

const levelNames = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

const messages = [
  'Processing request',
  'Database query completed',
  'User authenticated',
  'Cache hit',
  'Cache miss',
  'Connection established',
  'Task completed successfully',
  'Retrying operation',
  'Configuration loaded',
  'Service started',
  'Webhook received',
  'Email sent',
  'File uploaded',
  'Payment processed',
  'Notification dispatched',
];

const userIds = ['user_001', 'user_002', 'user_003', 'user_admin', 'user_guest'];
const requestIds = () => `req_${Math.random().toString(36).substring(2, 10)}`;
const durations = () => Math.floor(Math.random() * 2000);

function randomElement<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomExtras(level: string): Record<string, unknown> {
  const extras: Record<string, unknown> = {};

  if (Math.random() > 0.5) {
    extras.userId = randomElement(userIds);
  }
  if (Math.random() > 0.5) {
    extras.requestId = requestIds();
  }
  if (Math.random() > 0.5) {
    extras.duration = durations();
  }
  if (Math.random() > 0.7) {
    extras.metadata = {
      version: '1.0.0',
      environment: randomElement(['dev', 'staging', 'production']),
      region: randomElement(['us-east-1', 'eu-west-1', 'ap-south-1']),
    };
  }
  if ((level === 'error' || level === 'fatal') && Math.random() > 0.3) {
    extras.error = {
      message: 'Something went wrong',
      code: randomElement(['ERR_TIMEOUT', 'ERR_NOT_FOUND', 'ERR_UNAUTHORIZED', 'ERR_INTERNAL']),
      stack: 'Error: Something went wrong\n    at process (/app/index.js:42:15)',
    };
  }

  return extras;
}

function createLogger(channel: string, secretKey?: string): Logger {
  return pino({
    level: 'trace',
    transport: {
      target: '../packages/transport/dist/transports/pino.js',
      options: {
        url: API_URL,
        channel,
        ...(secretKey ? { secretKey } : {}),
      },
    },
  });
}

function logWithLevel(logger: Logger, level: string, message: string, extras: Record<string, unknown>, name?: string) {
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
  const { values } = parseArgs({
    options: {
      count: { type: 'string', short: 'c', default: '5' },
      delay: { type: 'string', short: 'd', default: '100' },
      key: { type: 'string', short: 'k' },
      name: { type: 'string', short: 'n' },
    },
  });

  const logsPerChannel = parseInt(values.count!, 10);
  const delayMs = parseInt(values.delay!, 10);
  const encryptionKey = values.key;
  const name = values.name;

  console.log(`Inserting ${logsPerChannel} logs per channel (${channels.join(', ')})`);
  console.log(`Delay between logs: ${delayMs}ms`);
  console.log(`API URL: ${API_URL}`);
  console.log(`Encryption: ${encryptionKey ? 'enabled' : 'disabled'}`);
  console.log(`Name: ${name || 'random'}\n`);

  // Create loggers for each channel
  const loggers = Object.fromEntries(
    channels.map((channel) => [channel, createLogger(channel, encryptionKey)])
  );

  for (let i = 0; i < logsPerChannel; i++) {
    for (const channel of channels) {
      const level = randomElement(levelNames);
      const message = randomElement(messages);
      const extras = generateRandomExtras(level);

      logWithLevel(loggers[channel], level, message, extras, name);
      console.log(`[${channel}] Sent log #${i + 1} (level: ${level})`);

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // Wait a bit for the transport to flush
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log('\nDone!');
}

main().catch(console.error);
