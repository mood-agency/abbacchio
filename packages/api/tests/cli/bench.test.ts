import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Subprocess } from 'bun';
import { Database } from 'bun:sqlite';

/** Temporary directories created by this file, removed after its tests. */
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));

  tempDirs.push(dir);

  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const cli = join(import.meta.dir, '../../src/cli.ts');

/** Emits 20 spans named "checkout" whose duration comes from config.ts. */
const EMIT = `
import { DURATION_MS } from './config.ts';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const now = BigInt(Date.now()) * 1_000_000n;
const spans = Array.from({ length: 20 }, (_, i) => ({
  traceId: 't' + i + Math.random(), spanId: 's' + i + Math.random(), name: 'checkout',
  startTimeUnixNano: String(now + BigInt(i) * 1000n),
  endTimeUnixNano: String(now + BigInt(i) * 1000n + BigInt(Math.round(DURATION_MS * 1e6))),
  attributes: [],
}));
await fetch(endpoint + '/v1/traces', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ resourceSpans: [{ resource: { attributes: [
    { key: 'service.name', value: { stringValue: 'shop' } }] }, scopeSpans: [{ spans }] }] }),
});
`;

let repo: string;

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !['SQLITE_PATH', 'NODE_ENV', 'PORT'].includes(k)) env[k] = v;
  }

  return env;
}

function run(cmd: string[], cwd: string, env: Record<string, string> = cleanEnv()) {
  const res = Bun.spawnSync(cmd, { cwd, env, stdout: 'pipe', stderr: 'pipe' });

  return { code: res.exitCode, stdout: res.stdout.toString(), stderr: res.stderr.toString() };
}

function setDuration(ms: number): void {
  writeFileSync(join(repo, 'config.ts'), `export const DURATION_MS = ${ms};\n`);
}

function bench(...args: string[]) {
  return run(['bun', cli, 'bench', '--run', 'bun emit.ts', '--settle', '100', ...args], repo);
}

beforeAll(() => {
  repo = tempDir('abbacchio-bench-test-');
  writeFileSync(join(repo, 'emit.ts'), EMIT);
  setDuration(10);

  for (const cmd of [
    ['git', 'init', '-q'],
    ['git', 'config', 'user.email', 'test@example.com'],
    ['git', 'config', 'user.name', 'test'],
    ['git', 'add', '-A'],
    ['git', 'commit', '-qm', 'baseline'],
  ]) {
    expect(run(cmd, repo).code).toBe(0);
  }
});

afterEach(() => setDuration(10));

describe('abbacchio bench', () => {
  it('flags a regression against HEAD (run in a temporary worktree) and exits 1', () => {
    setDuration(30);
    const r = bench('--json');

    expect(r.code).toBe(1);

    const report = JSON.parse(r.stdout);

    expect(report.baseline).toMatch(/^baseline-/);
    expect(report.candidate).toMatch(/-dirty$/);
    expect(report.results[0].name).toBe('checkout');
    expect(report.results[0].baseline.stats.mean).toBeCloseTo(10, 6);
    expect(report.results[0].candidate.stats.mean).toBeCloseTo(30, 6);

    // The temporary worktree is removed afterwards.
    expect(run(['git', 'worktree', 'list'], repo).stdout.trim().split('\n')).toHaveLength(1);
  });

  it('reports no change for identical code and exits 0', () => {
    const r = bench();

    expect(r.code).toBe(0);
    expect(r.stdout).toContain('no change');
  });

  it('documents its options under --help', () => {
    const r = run(['bun', cli, 'bench', '--help'], repo);

    expect(r.code).toBe(0);
    expect(r.stdout).toContain('--baseline <ref>');
  });

  it('saves stats and compares against them later', () => {
    const file = join(repo, 'baseline.json');

    expect(bench('--baseline', 'none', '--save', file).code).toBe(0);
    expect(JSON.parse(readFileSync(file, 'utf8')).spans.checkout.count).toBe(60) // 3 rounds x 20 spans;

    expect(bench('--against', file).code).toBe(0);

    setDuration(50);
    const r = bench('--against', file);

    expect(r.code).toBe(1);
    expect(r.stdout).toContain('REGRESSION');
  });

  it('exits 3 when no telemetry arrives and 2 when the command fails', () => {
    expect(run(['bun', cli, 'bench', '--run', 'true', '--settle', '0'], repo).code).toBe(3);

    const failed = run(['bun', cli, 'bench', '--run', 'exit 7', '--settle', '0'], repo);

    expect(failed.code).toBe(2);
    expect(failed.stderr).toContain('exited with code 7');
  });

  it('rejects bad arguments', () => {
    expect(run(['bun', cli, 'bench'], repo).code).toBe(2);
    expect(run(['bun', cli, 'bench', '--run', 'x', '--stat', 'p42'], repo).code).toBe(2);
    expect(run(['bun', cli, 'bench', '--run', 'x', '--baseline', 'HEAD', '--against', 'f.json'], repo).code).toBe(2);
    expect(run(['bun', cli, 'bench', '--run', 'x', '--against', 'missing.json'], repo).code).toBe(2);
  });
});

describe('bench rounds and noise', () => {
  it('interleaves rounds and treats a change within run-to-run noise as no change', () => {
    // Durations by call order. Rounds run B C, C B, B C, so the baseline gets
    // 10, 20, 10 (very noisy) and the candidate 13, 13, 13.
    // Lives outside the repository (passed by absolute path) so the baseline
    // worktree does not need to contain it, like packages/api/bench/load.ts.
    const scratch = tempDir('abbacchio-counter-');
    const counter = join(scratch, 'n');
    const script = join(scratch, 'noisy.ts');

    const noisy = `
      import { existsSync, readFileSync, writeFileSync } from 'fs';
      const file = ${JSON.stringify(counter)};
      const n = existsSync(file) ? Number(readFileSync(file, 'utf8')) : 0;
      writeFileSync(file, String(n + 1));
      const durations = [10, 13, 13, 20, 10, 13];
      const order = ['B', 'C', 'C', 'B', 'B', 'C'];
      if (!process.env.OTEL_RESOURCE_ATTRIBUTES.includes(order[n] === 'B' ? 'baseline-' : 'candidate-')) {
        console.error('unexpected round order at call ' + n);
        process.exit(9);
      }
      const ms = durations[n];
      ${EMIT.replace("import { DURATION_MS } from './config.ts';", '').replace(/DURATION_MS/g, 'ms')}
    `;

    writeFileSync(script, noisy);

    const r = run(['bun', cli, 'bench', '--run', `bun ${script}`, '--runs', '3', '--settle', '100', '--json'], repo);

    expect(r.code).toBe(0);

    const result = JSON.parse(r.stdout).results[0];

    expect(result.rounds.baseline).toEqual([10, 20, 10]);
    expect(result.rounds.candidate).toEqual([13, 13, 13]);
    expect(result.noisePct).toBeCloseTo(100, 6);
    expect(result.verdict).toBe('no_change');
    expect(result.notes.join(' ')).toContain('within run-to-run noise');
    // ±100% noise is far above the 10% threshold, so this "no change" proves little.
    expect(result.inconclusive).toBe(true);
    expect(JSON.parse(r.stdout).inconclusive).toBe(1);
  });

  it('prints a Markdown report', () => {
    setDuration(30);
    const r = bench('--format', 'markdown');

    expect(r.code).toBe(1);
    expect(r.stdout).toContain('| Name | Baseline | Candidate | Change | Noise | Verdict | Samples |');
    expect(r.stdout).toContain('🔴 regression');
  });
});

describe('abbacchio sandbox and an inherited SQLITE_PATH', () => {
  let child: Subprocess | undefined;

  afterEach(() => child?.kill());

  it('does not wipe a database it did not choose', async () => {
    const dir = tempDir('abbacchio-keep-');
    const db = join(dir, 'real.db');

    // Stands in for someone's real data.
    const seed = new Database(db);

    seed.run('CREATE TABLE precious (v TEXT)');
    seed.run("INSERT INTO precious VALUES ('keep me')");
    seed.close();

    const port = 47000 + Math.floor(Math.random() * 1000);

    child = Bun.spawn(['bun', cli, 'sandbox', '--port', String(port), '--quiet'], {
      env: { ...cleanEnv(), SQLITE_PATH: db },
      stdout: 'ignore',
      stderr: 'ignore',
    });

    let healthy = false;

    for (let i = 0; i < 100 && !healthy; i++) {
      healthy = Boolean((await fetch(`http://localhost:${port}/health`).catch(() => null))?.ok);

      if (!healthy) await Bun.sleep(50);
    }

    expect(healthy).toBe(true);
    expect(existsSync(db)).toBe(true);

    const check = new Database(db, { readonly: true });
    const row = check.prepare('SELECT v FROM precious').get() as { v: string } | null;

    check.close();
    expect(row?.v).toBe('keep me');
  });
});
