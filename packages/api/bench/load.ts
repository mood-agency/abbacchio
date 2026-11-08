/**
 * Load test for the Abbacchio API, made to run under `abbacchio bench`:
 *
 *   abbacchio bench --baseline origin/master --setup "bun install --frozen-lockfile" \
 *     --run "bun $PWD/packages/api/bench/load.ts"
 *
 * It starts the API server *of the checkout it runs in* (the current working
 * directory: the baseline worktree or the candidate), drives a fixed workload
 * against it, times every request with a monotonic clock, and exports one
 * OTLP span per request to $OTEL_EXPORTER_OTLP_ENDPOINT (the bench server).
 * Pass this file by absolute path so the baseline does not need to contain it.
 *
 * Query workloads run first, against a fixed preloaded dataset, so that how
 * fast a build ingests cannot change the size of the data it then queries.
 * Ingest workloads run for a minimum wall time rather than a fixed count, so
 * fast requests still span many of the server's 100 ms SQLite flushes (the
 * requests that coincide with a flush are the slow tail).
 *
 * Environment:
 *   ABBACCHIO_LOAD_ITERATIONS  minimum measured requests per workload (default 200)
 *   ABBACCHIO_LOAD_MIN_MS      minimum measured time per ingest workload (default 1500)
 *   ABBACCHIO_LOAD_WARMUP      unmeasured requests per workload first (default 30)
 *   ABBACCHIO_LOAD_PRELOAD     batches of 100 logs loaded before the queries (default 50)
 */

import { existsSync } from 'fs';
import { join, resolve } from 'path';

const ITERATIONS = Number(process.env.ABBACCHIO_LOAD_ITERATIONS ?? 200);
const WARMUP = Number(process.env.ABBACCHIO_LOAD_WARMUP ?? 30);
const MIN_MS = Number(process.env.ABBACCHIO_LOAD_MIN_MS ?? 1500);
const PRELOAD = Number(process.env.ABBACCHIO_LOAD_PRELOAD ?? 50);
const BATCH = 100;

const collector = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (!collector) {
  console.error('load.ts: OTEL_EXPORTER_OTLP_ENDPOINT is not set (run me via `abbacchio bench`)');
  process.exit(2);
}

const checkout = resolve(process.cwd());
const serverEntry = join(checkout, 'packages/api/src/server.ts');

if (!existsSync(serverEntry)) {
  console.error(`load.ts: ${serverEntry} not found; run from the repository root`);
  process.exit(2);
}

// ──────── server under test ────────

function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port ?? 0;

  probe.stop(true);

  return port;
}

const port = freePort();
const base = `http://localhost:${port}`;

const server = Bun.spawn(['bun', serverEntry], {
  cwd: join(checkout, 'packages/api'),
  env: {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    PORT: String(port),
    SQLITE_PATH: ':memory:',
    NODE_ENV: 'development', // no API_KEY requirement; same mode on every checkout
    ALLOW_ANON: 'true',
    ENABLE_RATE_LIMIT: 'false',
    ABBACCHIO_QUIET: 'true',
  },
  stdout: 'ignore', // older checkouts log every request
  stderr: 'inherit',
});

async function waitForHealth(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const res = await fetch(`${base}/health`).catch(() => null);

    if (res?.ok) return;

    await Bun.sleep(25);
  }

  throw new Error(`server at ${base} did not become healthy`);
}

// ──────── payloads ────────

const NOW_NANO = BigInt(Date.now()) * 1_000_000n;
const resource = { attributes: [{ key: 'service.name', value: { stringValue: 'load' } }] };

function otlpLogs(i: number) {
  return {
    resourceLogs: [{
      resource,
      scopeLogs: [{
        logRecords: Array.from({ length: BATCH }, (_, j) => ({
          timeUnixNano: String(NOW_NANO + BigInt(i * BATCH + j)),
          severityNumber: 9,
          body: { stringValue: `request ${i}-${j} handled user=${j % 17} path=/orders/${j}` },
          attributes: [
            { key: 'http.status_code', value: { intValue: 200 } },
            { key: 'user.id', value: { stringValue: `u${j % 17}` } },
          ],
        })),
      }],
    }],
  };
}

function otlpTraces(i: number) {
  return {
    resourceSpans: [{
      resource,
      scopeSpans: [{
        spans: Array.from({ length: BATCH }, (_, j) => {
          const start = NOW_NANO + BigInt(i * BATCH + j) * 1000n;

          return {
            traceId: `${i.toString(16).padStart(16, '0')}${j.toString(16).padStart(16, '0')}`,
            spanId: `${i.toString(16).padStart(8, '0')}${j.toString(16).padStart(8, '0')}`,
            name: `GET /orders/${j % 10}`,
            startTimeUnixNano: String(start),
            endTimeUnixNano: String(start + 2_500_000n),
            attributes: [{ key: 'http.method', value: { stringValue: 'GET' } }],
          };
        }),
      }],
    }],
  };
}

function otlpMetrics(i: number) {
  return {
    resourceMetrics: [{
      resource,
      scopeMetrics: [{
        metrics: [{
          name: 'http.server.duration',
          unit: 'ms',
          histogram: {
            dataPoints: Array.from({ length: BATCH }, (_, j) => ({
              timeUnixNano: String(NOW_NANO + BigInt(i * BATCH + j)),
              sum: 250,
              count: '10',
              bucketCounts: ['1', '4', '3', '2', '0'],
              explicitBounds: [10, 25, 50, 100],
              attributes: [{ key: 'route', value: { stringValue: `/orders/${j % 10}` } }],
            })),
          },
        }],
      }],
    }],
  };
}

function apiLogs(i: number) {
  return {
    logs: Array.from({ length: BATCH }, (_, j) => ({
      level: 30,
      time: Date.now(),
      msg: `job ${i}-${j} finished`,
      namespace: 'worker',
      jobId: `${i}-${j}`,
    })),
  };
}

// ──────── workloads ────────

interface Workload {
  name: string;
  request: (i: number) => Promise<Response>;
  /** Ingest workloads also run for at least MIN_MS. */
  timed?: boolean;
}

/** Request bodies sent by the workloads. */
type Payload = ReturnType<typeof otlpLogs> | ReturnType<typeof otlpTraces> | ReturnType<typeof otlpMetrics> | ReturnType<typeof apiLogs>;

const post = (path: string, body: Payload, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

// Queries first (fixed dataset), then ingestion.
const workloads: Workload[] = [
  { name: 'GET /api/logs (newest 100)', request: () => fetch(`${base}/api/logs?channel=load&limit=100`) },
  { name: 'GET /api/logs (full-text search)', request: (i) => fetch(`${base}/api/logs?channel=load&limit=100&search=${encodeURIComponent(`user=${i % 17}`)}`) },
  { name: `POST /v1/logs (${BATCH} records)`, request: (i) => post('/v1/logs', otlpLogs(PRELOAD + i)), timed: true },
  { name: `POST /v1/traces (${BATCH} spans)`, request: (i) => post('/v1/traces', otlpTraces(i)), timed: true },
  { name: `POST /v1/metrics (${BATCH} points)`, request: (i) => post('/v1/metrics', otlpMetrics(i)), timed: true },
  { name: `POST /api/logs (${BATCH} logs)`, request: (i) => post('/api/logs', apiLogs(i), { 'X-Channel': 'worker' }), timed: true },
];

async function preload(): Promise<void> {
  for (let i = 0; i < PRELOAD; i++) {
    const res = await post('/v1/logs', otlpLogs(i));

    await res.arrayBuffer();

    if (!res.ok) throw new Error(`preload: HTTP ${res.status}`);
  }

  // Let the server's batched SQLite flush (100 ms) persist the dataset.
  await Bun.sleep(300);
}

interface Sample {
  name: string;
  startNano: bigint;
  durationNano: bigint;
  status: number;
}

const samples: Sample[] = [];

async function runWorkload(w: Workload): Promise<void> {
  let measuredSince = 0;

  for (let i = 0; ; i++) {
    if (i === WARMUP) measuredSince = Date.now();

    if (i >= WARMUP + ITERATIONS && (!w.timed || Date.now() - measuredSince >= MIN_MS)) break;

    const wall = BigInt(Date.now()) * 1_000_000n;
    const t0 = process.hrtime.bigint();
    const res = await w.request(i);

    await res.arrayBuffer(); // include reading the body
    const duration = process.hrtime.bigint() - t0;

    if (!res.ok) throw new Error(`${w.name}: HTTP ${res.status}`);

    if (i >= WARMUP) samples.push({ name: w.name, startNano: wall, durationNano: duration, status: res.status });
  }
}

// ──────── export results ────────

async function exportSamples(): Promise<void> {
  const resourceAttrs = [{ key: 'service.name', value: { stringValue: 'abbacchio-api-perf' } }];

  for (const pair of (process.env.OTEL_RESOURCE_ATTRIBUTES ?? '').split(',')) {
    const eq = pair.indexOf('=');

    if (eq > 0) resourceAttrs.push({ key: pair.slice(0, eq).trim(), value: { stringValue: pair.slice(eq + 1).trim() } });
  }

  for (let offset = 0; offset < samples.length; offset += 500) {
    const spans = samples.slice(offset, offset + 500).map((s, k) => ({
      traceId: crypto.randomUUID().replace(/-/g, ''),
      spanId: (offset + k).toString(16).padStart(16, '0'),
      name: s.name,
      startTimeUnixNano: String(s.startNano),
      endTimeUnixNano: String(s.startNano + s.durationNano),
      attributes: [{ key: 'http.status_code', value: { intValue: s.status } }],
      status: { code: 1 },
    }));

    const res = await fetch(`${collector}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceSpans: [{ resource: { attributes: resourceAttrs }, scopeSpans: [{ spans }] }] }),
    });

    if (!res.ok) throw new Error(`exporting results failed: HTTP ${res.status}`);
  }
}

try {
  await waitForHealth();
  await preload();

  for (const w of workloads) await runWorkload(w);

  await exportSamples();
  console.log(`load.ts: ${samples.length} requests measured against ${checkout}`);
} finally {
  server.kill();
  await server.exited;
}
