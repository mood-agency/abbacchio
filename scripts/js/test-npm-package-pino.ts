#!/usr/bin/env npx tsx
/**
 * Test @abbacchio/transport pino integration from npm
 *
 * First install the package: npm install -g @abbacchio/transport pino
 * Or in any directory: npm install @abbacchio/transport pino
 *
 * Usage: npx tsx scripts/js/test-npm-package-pino.ts [options]
 *   --count <n>       Number of logs per channel (default: 5)
 *   --delay <ms>      Delay between logs in ms (default: 100)
 *   --key <key>       Encryption key (optional)
 *   --name <name>     Log name/namespace (default: random)
 *   --channel <name>  Channel name (default: npm-test)
 */

import pino from 'pino';
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

const options = parseScriptArgs(['npm-test']);
printConfig(options);

const logger = pino({
  level: 'trace',
  transport: {
    target: '@abbacchio/transport/pino',
    options: {
      url: API_URL,
      channel: options.channels[0],
      ...(options.key ? { secretKey: options.key } : {}),
    },
  },
});

async function main() {
  for (let i = 0; i < options.count; i++) {
    const level = randomElement(levelNames);
    const message = randomElement(messages);

    logger[level]({ name: options.name || randomElement(namespaces) }, message);
    console.log(`Sent log #${i + 1} (level: ${level})`);

    if (options.delay > 0) {
      await sleep(options.delay);
    }
  }

  // Wait for transport to flush
  await sleep(2000);
  console.log('\nDone!');
}

main().catch(console.error);
