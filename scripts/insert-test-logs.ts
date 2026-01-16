#!/usr/bin/env npx tsx
/**
 * Script to insert test logs into pino-live
 * Sends random logs to 3 channels: optimus, bumblebee, jazz
 *
 * Usage: npx tsx scripts/insert-test-logs.ts [options]
 *   --count <n>       Number of logs per channel (default: 5)
 *   --delay <ms>      Delay between logs in ms (default: 100)
 *   --key <key>       Encryption key (optional)
 *   --name <name>     Log name/namespace (default: random)
 */

import { encryptLog } from '../src/lib/crypto';
import { parseArgs } from 'util';

const API_URL = process.env.API_URL || 'http://localhost:4000/api/logs';

const channels = ['optimus', 'bumblebee', 'jazz'];

const namespaces = ['auth', 'api', 'db', 'cache', 'worker', 'scheduler'];

const levels = [10, 20, 30, 40, 50, 60]; // trace, debug, info, warn, error, fatal

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

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomLog() {
  const level = randomElement(levels);
  const base = {
    level,
    time: Date.now(),
    msg: randomElement(messages),
    pid: process.pid,
    hostname: 'test-machine',
  };

  // Add random extra fields
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
  if (level >= 50 && Math.random() > 0.3) {
    extras.error = {
      message: 'Something went wrong',
      code: randomElement(['ERR_TIMEOUT', 'ERR_NOT_FOUND', 'ERR_UNAUTHORIZED', 'ERR_INTERNAL']),
      stack: 'Error: Something went wrong\n    at process (/app/index.js:42:15)',
    };
  }

  return { ...base, ...extras };
}

async function sendLog(channel: string, log: object, encryptionKey?: string, name?: string) {
  const logWithName = { ...log, name: name || randomElement(namespaces) };
  const body = encryptionKey ? encryptLog(logWithName, encryptionKey) : logWithName;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Channel': channel,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Failed to send log: ${response.status} ${response.statusText}`);
  }

  return response.json();
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

  for (let i = 0; i < logsPerChannel; i++) {
    for (const channel of channels) {
      const log = generateRandomLog();
      try {
        await sendLog(channel, log, encryptionKey, name);
        console.log(`[${channel}] Sent log #${i + 1} (level: ${log.level})`);
      } catch (error) {
        console.error(`[${channel}] Failed to send log:`, error);
      }

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  console.log('\nDone!');
}

main().catch(console.error);
