import { describe, it, expect, afterAll, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Subprocess } from 'bun';

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


const root = join(import.meta.dir, '../..');
const cli = join(root, 'src/cli.ts');

let child: Subprocess | undefined;

afterEach(() => {
  child?.kill();
  child = undefined;
});

function freePort(): number {
  const s = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = s.port ?? 0;

  s.stop(true);

  return port;
}

async function waitForHealth(url: string): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    const res = await fetch(`${url}/health`).catch(() => null);

    if (res?.ok) return true;

    await Bun.sleep(50);
  }

  return false;
}

/** Child env without the test preload's settings, so the CLI picks its own defaults. */
function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !['SQLITE_PATH', 'NODE_ENV', 'PORT'].includes(k)) env[k] = v;
  }

  return { ...env, ...extra };
}

describe('abbacchio CLI', () => {
  it('prints help and version', async () => {
    const help = Bun.spawnSync(['bun', cli, '--help'], { env: cleanEnv() });

    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain('abbacchio sandbox');

    const version = Bun.spawnSync(['bun', cli, '--version'], { env: cleanEnv() });

    expect(version.exitCode).toBe(0);
  });

  it('rejects unknown commands and options', () => {
    expect(Bun.spawnSync(['bun', cli, 'nope'], { env: cleanEnv() }).exitCode).toBe(2);
    expect(Bun.spawnSync(['bun', cli, 'sandbox', '--nope'], { env: cleanEnv() }).exitCode).toBe(2);
    expect(Bun.spawnSync(['bun', cli, 'sandbox', '--port', 'abc'], { env: cleanEnv() }).exitCode).toBe(2);
  });

  it('sandbox starts anonymous, rate-limit-free, writes the env file and accepts OTLP', async () => {
    const dir = tempDir('abbacchio-cli-');
    const port = freePort();
    const envFile = join(dir, 'abbacchio.env');
    const url = `http://localhost:${port}`;

    child = Bun.spawn(
      ['bun', cli, 'sandbox', '--port', String(port), '--db', join(dir, 'sb.db'), '--env-file', envFile, '--quiet'],
      { env: cleanEnv(), stdout: 'ignore', stderr: 'ignore' },
    );

    expect(await waitForHealth(url)).toBe(true);

    // Env file appears once the server is healthy.
    for (let i = 0; i < 50 && !existsSync(envFile); i++) await Bun.sleep(20);

    const envText = readFileSync(envFile, 'utf8');

    expect(envText).toContain(`export OTEL_EXPORTER_OTLP_ENDPOINT=${url}`);
    expect(envText).toContain(`export ABBACCHIO_URL=${url}`);

    const ingest = await fetch(`${url}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceSpans: [] }),
    });

    expect(ingest.status).toBe(200);

    // Production mode with ALLOW_ANON: /api works without a key, SQL is enabled for agents.
    const sql = await fetch(`${url}/api/sql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'SELECT 1 AS one' }),
    });

    expect(sql.status).toBe(200);
  });
});

describe('bundled build', () => {
  it('keeps NODE_ENV a runtime lookup (not inlined as "development")', async () => {
    const proc = Bun.spawnSync(['bun', join(root, 'scripts/build.ts')], { cwd: root, env: cleanEnv() });

    expect(proc.exitCode).toBe(0);

    const bundle = readFileSync(join(root, 'dist/cli.js'), 'utf8');

    expect(bundle).not.toMatch(/IS_DEV = true/);
    expect(bundle).toContain('process.env.NODE_ENV');
  });
});
