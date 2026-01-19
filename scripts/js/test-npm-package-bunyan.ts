#!/usr/bin/env npx tsx
/**
 * Script to test @abbacchio/transport package from npm with Bunyan
 *
 * This script installs the package from npm in a temp directory and runs a test.
 * Uses "@abbacchio/transport/transports/bunyan" as the transport target, just like
 * an external developer would use it.
 *
 * Usage: npx tsx scripts/js/test-npm-package-bunyan.ts [options]
 *   --version <v>     Package version to install (default: latest)
 *   --count <n>       Number of logs per channel (default: 5)
 *   --delay <ms>      Delay between logs in ms (default: 100)
 *   --key <key>       Encryption key (optional)
 *   --name <name>     Log name/namespace (default: random)
 *   --channel <name>  Channel name(s), comma-separated (default: npm-test-bunyan)
 *   --keep            Keep the temp directory after test
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  API_URL,
  namespaces,
  levelNames,
  messages,
} from './test-utils';

interface Options {
  version: string;
  count: number;
  delay: number;
  key?: string;
  name?: string;
  channels: string[];
  keep: boolean;
}

function parseOptions(): Options {
  const { values } = parseArgs({
    options: {
      version: { type: 'string', short: 'v', default: 'latest' },
      count: { type: 'string', short: 'c', default: '5' },
      delay: { type: 'string', short: 'd', default: '100' },
      key: { type: 'string', short: 'k' },
      name: { type: 'string', short: 'n' },
      channel: { type: 'string', short: 'C', default: 'npm-test-bunyan' },
      keep: { type: 'boolean', default: false },
    },
  });

  return {
    version: values.version!,
    count: parseInt(values.count!, 10),
    delay: parseInt(values.delay!, 10),
    key: values.key,
    name: values.name,
    channels: values.channel!.split(',').map((c) => c.trim()),
    keep: values.keep!,
  };
}

function generateTestScript(options: Options): string {
  const logData = {
    levels: levelNames,
    messages,
    namespaces,
    extras: [
      { userId: 'user_001', requestId: 'req_abc123' },
      { userId: 'user_002', duration: 150 },
      { requestId: 'req_xyz789', metadata: { env: 'test' } },
      { error: { message: 'Test error', code: 'ERR_TEST' } },
    ],
  };

  return `
import bunyan from 'bunyan';
import { bunyanStream } from '@abbacchio/transport/transports/bunyan';

const API_URL = '${API_URL}';
const channels = ${JSON.stringify(options.channels)};
const count = ${options.count};
const delay = ${options.delay};
const secretKey = ${options.key ? `'${options.key}'` : 'undefined'};
const name = ${options.name ? `'${options.name}'` : 'undefined'};

const levels = ${JSON.stringify(logData.levels)};
const messages = ${JSON.stringify(logData.messages)};
const namespaces = ${JSON.stringify(logData.namespaces)};
const extrasList = ${JSON.stringify(logData.extras)};

// Map our level names to bunyan levels
const levelMap = {
  trace: bunyan.TRACE,
  debug: bunyan.DEBUG,
  info: bunyan.INFO,
  warn: bunyan.WARN,
  error: bunyan.ERROR,
  fatal: bunyan.FATAL,
};

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createLogger(channel, loggerName) {
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

function logWithLevel(logger, level, message, extras) {
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
  console.log('Creating loggers for channels:', channels.join(', '));

  const loggers = Object.fromEntries(
    channels.map(channel => [
      channel,
      createLogger(channel, name || randomElement(namespaces))
    ])
  );

  for (let i = 0; i < count; i++) {
    for (const channel of channels) {
      const level = randomElement(levels);
      const message = randomElement(messages);
      const extras = {
        ...randomElement(extrasList),
      };

      logWithLevel(loggers[channel], level, message, extras);
      console.log(\`[\${channel}] Sent log #\${i + 1} (level: \${level})\`);

      if (delay > 0) {
        await sleep(delay);
      }
    }
  }

  // Wait for transport to flush
  await sleep(2000);
  console.log('\\nDone!');
}

main().catch(console.error);
`;
}

async function main() {
  const options = parseOptions();

  console.log('='.repeat(60));
  console.log('Testing @abbacchio/transport (Bunyan) from npm');
  console.log('='.repeat(60));
  console.log(`Version: ${options.version}`);
  console.log(`API URL: ${API_URL}`);
  console.log(`Channels: ${options.channels.join(', ')}`);
  console.log(`Logs per channel: ${options.count}`);
  console.log(`Delay: ${options.delay}ms`);
  console.log(`Encryption: ${options.key ? 'enabled' : 'disabled'}`);
  console.log(`Name: ${options.name || 'random'}`);
  console.log('');

  // Create temp directory
  const tempDir = mkdtempSync(join(tmpdir(), 'abbacchio-test-bunyan-'));
  console.log(`Created temp directory: ${tempDir}`);

  try {
    // Create package.json
    const packageSpec =
      options.version === 'latest' ? 'latest' : options.version;

    const packageJson = {
      name: 'abbacchio-npm-test-bunyan',
      version: '1.0.0',
      type: 'module',
      dependencies: {
        '@abbacchio/transport': packageSpec,
        bunyan: '^1.8.15',
      },
    };

    writeFileSync(join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2));
    console.log('Created package.json');

    // Install dependencies
    console.log('\nInstalling dependencies...');
    execSync('npm install', {
      cwd: tempDir,
      stdio: 'inherit',
    });

    // Verify installation
    const pkgJsonPath = join(tempDir, 'node_modules/@abbacchio/transport/package.json');
    if (!existsSync(pkgJsonPath)) {
      throw new Error('@abbacchio/transport was not installed correctly');
    }

    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    console.log(`\nInstalled @abbacchio/transport@${pkg.version}`);

    // Create test script
    const testScript = generateTestScript(options);
    writeFileSync(join(tempDir, 'test.mjs'), testScript);
    console.log('Created test script');

    console.log('\n' + '-'.repeat(60));
    console.log('Running test...');
    console.log('-'.repeat(60) + '\n');

    // Run the test script
    execSync('node test.mjs', {
      cwd: tempDir,
      stdio: 'inherit',
    });

    console.log('\n' + '='.repeat(60));
    console.log('SUCCESS: @abbacchio/transport (Bunyan) npm package works correctly!');
    console.log('='.repeat(60));
  } finally {
    if (options.keep) {
      console.log(`\nTemp directory kept at: ${tempDir}`);
    } else {
      rmSync(tempDir, { recursive: true, force: true });
      console.log('\nTemp directory cleaned up');
    }
  }
}

main().catch((error) => {
  console.error('Test failed:', error.message);
  process.exit(1);
});
