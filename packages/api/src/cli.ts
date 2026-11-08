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
  abbacchio bench [options]   Run a command against a baseline and the working tree,
                              compare every span and exit 1 on a regression
  abbacchio --help | --version

Sandbox options:
  -p, --port <n>        Port to listen on (default: $PORT or 4000)
      --db <path>       SQLite file, or :memory: (default: <tmpdir>/abbacchio-sandbox-<port>.db)
      --keep            Keep data between restarts (do not wipe the database)
      --env-file <path> Write "export ..." lines for the program under test
  -q, --quiet           Only print errors

Bench options:
      --run <cmd>       Command that exercises the program (required). It gets
                        OTEL_EXPORTER_OTLP_ENDPOINT and service.version set
      --baseline <ref>  Git ref for the baseline, run in a temporary worktree
                        (default: HEAD; "none" to skip)
      --against <file>  Use stats saved with --save as the baseline instead
      --save <file>     Save the candidate's stats (to use later with --against)
      --setup <cmd>     Run once in each checkout first (e.g. "bun install")
      --runs <n>        Rounds: run each build n times, interleaved, to measure
                        run-to-run noise (default: 3)
      --span <name>     Only compare these spans (repeatable; default: all)
      --metric <name>   Also compare this metric (repeatable)
      --stat <s>        mean|p50|p90|p95|p99|max (default: p95)
      --threshold <pct> Change that counts as real (default: 10)
      --direction <d>   For metrics: lower|higher is better (default: lower)
      --min-samples <n> Observations needed per build (default: 5)
      --settle <ms>     Wait after the last run for exporters to flush (default: 1500)
      --format <f>      text|json|markdown (default: text)
      --json            Same as --format json
  Exit codes: 0 ok, 1 regression, 2 error, 3 not enough data

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

  // Only wipe a database the sandbox chose itself (or was handed with --db):
  // a SQLITE_PATH inherited from the shell may be someone's real data.
  const inheritedDb = values.db === undefined && process.env.SQLITE_PATH !== undefined;

  if (values.db !== undefined) process.env.SQLITE_PATH = values.db === ':memory:' ? values.db : resolve(values.db);

  setDefault('SQLITE_PATH', join(tmpdir(), `abbacchio-sandbox-${port}.db`));

  if (values.keep || inheritedDb) process.env.SQLITE_EPHEMERAL = 'false';

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

  const wiped = process.env.SQLITE_EPHEMERAL === 'true'
    ? ' (wiped on every start)'
    : inheritedDb ? ' (from $SQLITE_PATH, kept; pass --db to use a throwaway file)' : '';

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

function parsePositiveInt(raw: string | undefined, flag: string, fallback: number): number {
  if (raw === undefined) return fallback;

  if (!/^\d+$/.test(raw) || Number(raw) < 1) fail(`${flag} must be a positive integer`);

  return Number(raw);
}

async function benchCommand(args: string[]): Promise<void> {
  let values;

  try {
    ({ values } = parseArgs({
      args,
      options: {
        run: { type: 'string' },
        baseline: { type: 'string' },
        against: { type: 'string' },
        save: { type: 'string' },
        setup: { type: 'string' },
        runs: { type: 'string' },
        span: { type: 'string', multiple: true },
        metric: { type: 'string', multiple: true },
        stat: { type: 'string' },
        threshold: { type: 'string' },
        direction: { type: 'string' },
        'min-samples': { type: 'string' },
        settle: { type: 'string' },
        json: { type: 'boolean', default: false },
        format: { type: 'string' },
        port: { type: 'string', short: 'p' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  const { bench, formatReport, formatMarkdown, BenchError, EXIT_ERROR } = await import('./bench.js');

  const format = values.json ? 'json' : (values.format ?? 'text');

  if (format !== 'text' && format !== 'json' && format !== 'markdown') fail('--format must be text, json or markdown');
  const { isCompareDirection, isCompareStat } = await import('./lib/compare.js');

  if (!values.run) fail('bench needs --run "<command>"');

  const stat = values.stat ?? 'p95';

  if (!isCompareStat(stat)) fail(`--stat must be one of mean, p50, p90, p95, p99, max`);

  const direction = values.direction ?? 'lower';

  if (!isCompareDirection(direction)) fail('--direction must be "lower" or "higher"');

  const thresholdPct = values.threshold === undefined ? 10 : Number(values.threshold);

  if (!Number.isFinite(thresholdPct) || thresholdPct < 0) fail('--threshold must be a number >= 0');

  const settle = values.settle === undefined ? 1500 : Number(values.settle);

  if (!Number.isFinite(settle) || settle < 0) fail('--settle must be a number of milliseconds >= 0');

  if (values.port !== undefined && (!/^\d+$/.test(values.port) || Number(values.port) > 65535)) {
    fail(`invalid port "${values.port}"`);
  }

  const baselineRef = values.against ? undefined : (values.baseline ?? 'HEAD');

  if (values.against && values.baseline) fail('use either --baseline or --against, not both');

  // Snapshot the caller's environment for the program under test before
  // configuring the private in-process server below.
  const callerEnv = { ...process.env };

  process.env.PORT = values.port ?? '0'; // 0 = any free port
  process.env.SQLITE_PATH = ':memory:';
  process.env.SQLITE_EPHEMERAL = 'false';
  process.env.ALLOW_ANON = 'true';
  process.env.ENABLE_RATE_LIMIT = 'false';
  process.env.ABBACCHIO_QUIET = 'true';
  delete process.env.API_KEY;

  const { port } = await startServer();
  const url = `http://localhost:${port}`;

  let code = EXIT_ERROR;

  try {
    const report = await bench({
      run: values.run,
      setup: values.setup,
      baselineRef: baselineRef === 'none' ? undefined : baselineRef,
      against: values.against,
      save: values.save,
      runs: parsePositiveInt(values.runs, '--runs', 3),
      spans: values.span,
      metrics: values.metric ?? [],
      stat,
      thresholdPct,
      direction,
      minSamples: parsePositiveInt(values['min-samples'], '--min-samples', 5),
      settleMs: settle,
      json: format === 'json',
      cwd: process.cwd(),
      url,
      env: callerEnv,
    });

    const output = format === 'json'
      ? JSON.stringify(report, null, 2)
      : format === 'markdown' ? formatMarkdown(report) : formatReport(report);

    console.log(output);
    code = report.exitCode;
  } catch (err) {
    if (!(err instanceof BenchError)) throw err;

    console.error(`abbacchio bench: ${err.message}`);
  }

  process.exit(code);
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
    case 'bench':
      await benchCommand(rest);
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
