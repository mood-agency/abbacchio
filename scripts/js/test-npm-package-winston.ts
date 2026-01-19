#!/usr/bin/env npx tsx
/**
 * Test @abbacchio/transport winston integration from npm
 *
 * First install the package: npm install -g @abbacchio/transport winston
 * Or in any directory: npm install @abbacchio/transport winston
 *
 * Usage: npx tsx scripts/js/test-npm-package-winston.ts [options]
 *   --count <n>       Number of logs per channel (default: 5)
 *   --delay <ms>      Delay between logs in ms (default: 100)
 *   --key <key>       Encryption key (optional)
 *   --name <name>     Log name/namespace (default: random)
 *   --channel <name>  Channel name(s), comma-separated (default: npm-test-winston)
 */

import winston from 'winston';
// @ts-expect-error - resolved by pnpm workspace
import { AbbacchioWinstonTransport } from '@abbacchio/transport/transports/winston';
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

const levelMap: Record<string, string> = {
  trace: 'silly',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
};

function createLogger(channel: string, secretKey?: string) {
  return winston.createLogger({
    level: 'silly',
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

async function main() {
  const options = parseScriptArgs(['npm-test-winston']);
  printConfig(options);

  console.log('Creating loggers for channels:', options.channels.join(', '));

  const loggers = Object.fromEntries(
    options.channels.map(channel => [channel, createLogger(channel, options.key)])
  );

  for (let i = 0; i < options.count; i++) {
    for (const channel of options.channels) {
      const level = randomElement(levelNames);
      const winstonLevel = levelMap[level] || 'info';
      const message = randomElement(messages);
      const extraData = {
        ...randomElement(extras),
        namespace: options.name || randomElement(namespaces),
      };

      loggers[channel].log(winstonLevel, message, extraData);
      console.log(`[${channel}] Sent log #${i + 1} (level: ${level})`);

      if (options.delay > 0) {
        await sleep(options.delay);
      }
    }
  }

  // Wait for transport to flush
  await sleep(2000);

  // Close all loggers
  for (const logger of Object.values(loggers)) {
    logger.close();
  }

  console.log('\nDone!');
}

main().catch(console.error);
