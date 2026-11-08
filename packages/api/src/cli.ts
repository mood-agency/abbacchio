#!/usr/bin/env bun
/**
 * Abbacchio command line.
 *
 *   abbacchio [start]          Start the server, configured by environment variables.
 *   abbacchio sandbox [opts]   Throwaway instance for agents, CI and sandboxes.
 *
 * The server reads its configuration from process.env when it is imported,
 * so every default is applied *before* the dynamic import below.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { parseArgs } from 'util';

declare const ABBACCHIO_VERSION: string | undefined;

const VERSION = typeof ABBACCHIO_VERSION === 'string' ? ABBACCHIO_VERSION : 'dev';

const HELP = `Abbacchio ${VERSION} — real-time logs, metrics and traces over HTTP/OTLP

Usage:
  abbacchio [start]           Start the server (configured by environment variables)
  abbacchio sandbox [options] Throwaway instance for agents, CI and sandboxes:
                              anonymous access, no rate limit, SQL endpoint on,
                              database wiped on every start
  abbacchio --help | --version

Sandbox options:
  -p, --port <n>        Port to listen on (default: $PORT or 4000)
      --db <path>       SQLite file, or :memory: (default: <tmpdir>/abbacchio-sandbox-<port>.db)
      --keep            Keep data between restarts (do not wipe the database)
      --env-file <path> Write "export ..." lines for the program under test
  -q, --quiet           Only print errors

Environment variables always win over sandbox defaults; flags win over both.
See https://github.com/mood-agency/abbacchio/blob/master/docs/configuration.md
`;

/** Set an env var unless the caller already chose a value. */
function setDefault(key: string, value: string): void {
  if (process.env[key] === undefined) process.env[key] = value;
}

function fail(message: string): never {
  console.error(`abbacchio: ${message}\n\nRun "abbacchio --help" for usage.`);
  process.exit(2);
}

async function startServer(): Promise<{ port: number; dashboard: boolean }> {
  const mod = await import('./server.js');

  return { port: mod.server.port ?? Number(process.env.PORT), dashboard: mod.shouldServeDashboard };
}

async function sandbox(args: string[]): Promise<void> {
  let values;

  try {
    ({ values } = parseArgs({
      args,
      options: {
        port: { type: 'string', short: 'p' },
        db: { type: 'string' },
        keep: { type: 'boolean', default: false },
        'env-file': { type: 'string' },
        quiet: { type: 'boolean', short: 'q', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  if (values.port !== undefined) {
    if (!/^\d+$/.test(values.port) || Number(values.port) > 65535) fail(`invalid port "${values.port}"`);

    process.env.PORT = values.port;
  }

  setDefault('PORT', '4000');
  const port = process.env.PORT ?? '4000';

  if (values.db !== undefined) process.env.SQLITE_PATH = values.db === ':memory:' ? values.db : resolve(values.db);

  setDefault('SQLITE_PATH', join(tmpdir(), `abbacchio-sandbox-${port}.db`));

  if (values.keep) process.env.SQLITE_EPHEMERAL = 'false';

  setDefault('SQLITE_EPHEMERAL', 'true');
  setDefault('NODE_ENV', 'production'); // serve the bundled dashboard, production logging
  setDefault('ALLOW_ANON', 'true');
  setDefault('ENABLE_RATE_LIMIT', 'false'); // load tests would otherwise hit 429s
  setDefault('ENABLE_SQL_ENDPOINT', 'true');
  setDefault('CORS_ORIGIN', '*'); // browser apps on any local port
  process.env.ABBACCHIO_QUIET = 'true';

  if (process.env.SQLITE_PATH !== ':memory:') {
    mkdirSync(dirname(process.env.SQLITE_PATH ?? '.'), { recursive: true });
  }

  const { port: actualPort, dashboard } = await startServer();
  const url = `http://localhost:${actualPort}`;

  const health = await fetch(`${url}/health`).catch(() => null);

  if (!health?.ok) fail(`server did not become healthy at ${url}/health`);

  const exports = [
    `export ABBACCHIO_URL=${url}`,
    `export OTEL_EXPORTER_OTLP_ENDPOINT=${url}`,
    'export OTEL_EXPORTER_OTLP_PROTOCOL=http/json',
  ];

  if (values['env-file']) {
    const envFile = resolve(values['env-file']);

    mkdirSync(dirname(envFile), { recursive: true });
    writeFileSync(envFile, `${exports.join('\n')}\n`);
  }

  if (values.quiet) return;

  const wiped = process.env.SQLITE_EPHEMERAL === 'true' ? ' (wiped on every start)' : '';

  console.log(`Abbacchio sandbox ready: ${url}

  API:        ${url}/api   (OTLP: ${url}/v1/{logs,metrics,traces})
  Dashboard:  ${dashboard ? url : 'not bundled'}
  Database:   ${process.env.SQLITE_PATH}${wiped}
  Compare:    ${url}/api/compare?source=span&name=<span>&baselineVersion=<a>&candidateVersion=<b>

Point the program under test at it, tagging each build with service.version:
  ${exports.join('\n  ')}
  export OTEL_RESOURCE_ATTRIBUTES="service.version=$(git rev-parse --short HEAD)"
${values['env-file'] ? `\n(written to ${resolve(values['env-file'])})\n` : ''}`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case undefined:
    case 'start':
      if (rest.length > 0) fail(`"start" takes no arguments; configure it with environment variables`);

      await startServer();
      break;
    case 'sandbox':
      await sandbox(rest);
      break;
    case '-h':
    case '--help':
    case 'help':
      console.log(HELP);
      break;
    case '-v':
    case '--version':
      console.log(VERSION);
      break;
    default:
      fail(`unknown command "${command}"`);
  }
}

await main();
