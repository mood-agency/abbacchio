/**
 * Shared utilities for test log generation scripts
 */

import { parseArgs } from 'node:util';

// Transports POST OTLP to {endpoint}/v1/*, so only the origin matters; a
// legacy value like http://host:4000/api/logs still works.
export const API_URL = new URL(process.env.API_URL || 'http://localhost:4000').origin;

export const defaultChannels = ['API', 'Worker1', 'Worker2','Worker3','Worker4','Worker5','Worker6','Worker7'] as const;

export const namespaces = ['init', 'processing', 'shutdown', 'cache', 'worker', 'scheduler'];

export const levelNames = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

export const messages = [
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

export const userIds = ['user_001', 'user_002', 'user_003', 'user_admin', 'user_guest'];

export function randomElement<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomRequestId(): string {
  return `req_${Math.random().toString(36).substring(2, 10)}`;
}

export function randomDuration(): number {
  return Math.floor(Math.random() * 2000);
}

export function generateRandomExtras(level: string): Record<string, unknown> {
  const extras: Record<string, unknown> = {};

  if (Math.random() > 0.5) {
    extras.userId = randomElement(userIds);
  }
  if (Math.random() > 0.5) {
    extras.requestId = randomRequestId();
  }
  if (Math.random() > 0.5) {
    extras.duration = randomDuration();
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ScriptOptions {
  count: number;
  delay: number;
  name?: string;
  channels: readonly string[];
}

export function parseScriptArgs(defaultCh: readonly string[]): ScriptOptions {
  const { values } = parseArgs({
    options: {
      count: { type: 'string', short: 'c', default: '5' },
      delay: { type: 'string', short: 'd', default: '100' },
      name: { type: 'string', short: 'n' },
      channel: { type: 'string', short: 'C' },
    },
  });

  const channels = values.channel
    ? values.channel.split(',').map((c: string) => c.trim())
    : defaultCh;

  return {
    count: parseInt(values.count!, 10),
    delay: parseInt(values.delay!, 10),
    name: values.name,
    channels,
  };
}

export function printConfig(options: ScriptOptions): void {
  console.log(`Inserting ${options.count} logs per channel (${options.channels.join(', ')})`);
  console.log(`Delay between logs: ${options.delay}ms`);
  console.log(`API URL: ${API_URL}`);
  console.log(`Name: ${options.name || 'random'}\n`);
}
