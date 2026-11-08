/**
 * `abbacchio bench`: run a command against a baseline and a candidate build,
 * collect their telemetry in an in-process Abbacchio server, compare every
 * span (and any requested metric) and report regressions with an exit code.
 *
 * Runs are told apart by time window, not only by service.version, so a
 * program that hard-codes its own version still compares correctly.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative, resolve } from 'path';
import { getDatabase, type RunSelector } from './lib/database.js';
import {
  compareStats,
  summarizeRun,
  type CompareDirection,
  type CompareResult,
  type CompareSource,
  type CompareStat,
  type CompareVerdict,
  type RunStats,
} from './lib/compare.js';

export const BENCH_FILE_FORMAT = 'abbacchio-bench/1';

export const EXIT_OK = 0;
export const EXIT_REGRESSION = 1;
export const EXIT_ERROR = 2;
export const EXIT_INSUFFICIENT = 3;

export interface BenchOptions {
  /** Shell command that exercises the program and emits telemetry. */
  run: string;
  /** Shell command run once in each checkout before the runs (e.g. "bun install"). */
  setup?: string;
  /** Git ref to use as the baseline, checked out in a temporary worktree. */
  baselineRef?: string;
  /** Saved stats file to use as the baseline instead of running one. */
  against?: string;
  /** Write the candidate run's stats here, for a later --against. */
  save?: string;
  runs: number;
  /** Span names to compare; default: every span seen in either run. */
  spans?: string[];
  metrics: string[];
  stat: CompareStat;
  thresholdPct: number;
  direction: CompareDirection;
  minSamples: number;
  /** Wait after the last run so batched exporters can flush. */
  settleMs: number;
  json: boolean;
  cwd: string;
  /** Base URL of the in-process server. */
  url: string;
  /** Environment for the program under test (the caller's, before server setup). */
  env: Record<string, string | undefined>;
}

export interface BenchFile {
  format: typeof BENCH_FILE_FORMAT;
  label: string;
  createdAt: string;
  command: string;
  spans: Record<string, RunStats>;
  metrics: Record<string, RunStats>;
}

interface Phase {
  label: string;
  selector: RunSelector;
}

export interface BenchReport {
  baseline: string | null;
  candidate: string;
  stat: CompareStat;
  thresholdPct: number;
  results: CompareResult[];
  regressions: number;
  improvements: number;
  unchanged: number;
  insufficient: number;
  exitCode: number;
}

export class BenchError extends Error {}

// ──────── processes ────────

async function sh(command: string, cwd: string, env: ProcessEnv, forwardOutput: boolean): Promise<number> {
  const proc = Bun.spawn(['sh', '-c', command], {
    cwd,
    env,
    stdin: 'ignore',
    // The command's stdout goes to our stderr so `--json` output stays clean.
    stdout: forwardOutput ? 2 : 'ignore',
    stderr: forwardOutput ? 'inherit' : 'ignore',
  });

  return proc.exited;
}

function git(args: string[], cwd: string): string {
  const res = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });

  if (res.exitCode !== 0) {
    throw new BenchError(`git ${args.join(' ')} failed: ${res.stderr.toString().trim()}`);
  }

  return res.stdout.toString().trim();
}

function log(message: string): void {
  console.error(`[bench] ${message}`);
}

/** Child env: OTLP endpoint and a service.version label, keeping the caller's other resource attributes. */
/** Environment variables for a child process. */
export type ProcessEnv = Record<string, string>;

function childEnv(opts: BenchOptions, label: string): ProcessEnv {
  const env: ProcessEnv = {};

  for (const [k, v] of Object.entries(opts.env)) {
    if (v !== undefined) env[k] = v;
  }

  const otherAttrs = (env.OTEL_RESOURCE_ATTRIBUTES ?? '')
    .split(',')
    .filter((pair) => pair.trim() && !pair.trim().startsWith('service.version='));

  env.OTEL_RESOURCE_ATTRIBUTES = [...otherAttrs, `service.version=${label}`].join(',');
  env.OTEL_EXPORTER_OTLP_ENDPOINT = opts.url;
  env.OTEL_EXPORTER_OTLP_PROTOCOL = 'http/json';
  env.ABBACCHIO_URL = opts.url;
  env.ABBACCHIO_BENCH_LABEL = label;

  return env;
}

async function runPhase(opts: BenchOptions, label: string, cwd: string): Promise<Phase> {
  const env = childEnv(opts, label);

  if (opts.setup) {
    log(`${label}: setup: ${opts.setup}`);
    const code = await sh(opts.setup, cwd, env, true);

    if (code !== 0) throw new BenchError(`${label}: setup command exited with code ${code}`);
  }

  // Leave a gap so the windows of consecutive phases never overlap.
  await Bun.sleep(5);
  const since = Date.now();

  for (let i = 1; i <= opts.runs; i++) {
    log(`${label}: run ${i}/${opts.runs}: ${opts.run}`);
    const code = await sh(opts.run, cwd, env, true);

    if (code !== 0) throw new BenchError(`${label}: command exited with code ${code}`);
  }

  await Bun.sleep(opts.settleMs);
  const until = Date.now();

  await Bun.sleep(5);

  return { label, selector: { since, until } };
}

// ──────── git checkouts ────────

interface Checkout {
  cwd: string;
  label: string;
  cleanup: () => void;
}

function checkoutBaseline(opts: BenchOptions): Checkout {
  const ref = opts.baselineRef ?? 'HEAD';
  const top = git(['rev-parse', '--show-toplevel'], opts.cwd);
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`], opts.cwd);
  const short = sha.slice(0, 7);
  const dir = mkdtempSync(join(tmpdir(), 'abbacchio-bench-'));

  git(['worktree', 'add', '--detach', dir, sha], top);

  const cleanup = () => {
    try {
      git(['worktree', 'remove', '--force', dir], top);
    } catch {
      rmSync(dir, { recursive: true, force: true });
      Bun.spawnSync(['git', 'worktree', 'prune'], { cwd: top });
    }
  };

  // Run from the same sub-directory of the repository as the caller.
  return { cwd: join(dir, relative(top, opts.cwd)), label: `baseline-${short}`, cleanup };
}

function candidateLabel(cwd: string): string {
  try {
    const short = git(['rev-parse', '--short', 'HEAD'], cwd);
    const dirty = git(['status', '--porcelain'], cwd) !== '';

    return `candidate-${short}${dirty ? '-dirty' : ''}`;
  } catch {
    return 'candidate';
  }
}

// ──────── stats files ────────

export function readBenchFile(path: string): BenchFile {
  if (!existsSync(path)) throw new BenchError(`baseline file not found: ${path}`);

  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new BenchError(`baseline file is not valid JSON: ${path} (${err instanceof Error ? err.message : err})`);
  }

  if (
    parsed === null || typeof parsed !== 'object' ||
    !('format' in parsed) || parsed.format !== BENCH_FILE_FORMAT ||
    !('spans' in parsed) || typeof parsed.spans !== 'object' ||
    !('metrics' in parsed) || typeof parsed.metrics !== 'object'
  ) {
    throw new BenchError(`${path} is not an ${BENCH_FILE_FORMAT} file (create one with --save)`);
  }

  // SAFETY: format, spans and metrics were checked above; stats objects are produced by --save.
  return parsed as BenchFile;
}

// ──────── comparison ────────

function statsFor(source: CompareSource, name: string, phase: Phase, notes: string[]): RunStats {
  return summarizeRun(getDatabase(), source, name, phase.selector, phase.label, notes);
}

function compareOne(
  opts: BenchOptions,
  source: CompareSource,
  name: string,
  baseline: { label: string; stats: RunStats },
  candidate: Phase,
): CompareResult {
  const notes: string[] = [];
  const candidateStats = statsFor(source, name, candidate, notes);

  return compareStats(
    {
      source,
      name,
      baseline: { version: baseline.label },
      candidate: { version: candidate.label, ...candidate.selector },
      stat: opts.stat,
      thresholdPct: opts.thresholdPct,
      direction: source === 'span' ? 'lower' : opts.direction,
      minSamples: opts.minSamples,
    },
    baseline.stats,
    candidateStats,
    notes,
  );
}

function summarize(opts: BenchOptions, baseline: string | null, candidate: string, results: CompareResult[]): BenchReport {
  const count = (v: string) => results.filter((r) => r.verdict === v).length;
  const regressions = count('regression');
  const insufficient = count('insufficient_data');

  let exitCode = EXIT_OK;

  if (regressions > 0) exitCode = EXIT_REGRESSION;
  else if (insufficient === results.length) exitCode = EXIT_INSUFFICIENT; // includes "nothing received"

  return {
    baseline,
    candidate,
    stat: opts.stat,
    thresholdPct: opts.thresholdPct,
    results,
    regressions,
    improvements: count('improvement'),
    unchanged: count('no_change'),
    insufficient,
    exitCode,
  };
}

function fmt(n: number | null | undefined, unit: string | null): string {
  if (n === null || n === undefined) return 'n/a';

  const abs = Math.abs(n);
  const text = abs >= 100 ? n.toFixed(0) : abs >= 1 ? n.toFixed(2) : n.toPrecision(3);

  return unit ? `${text} ${unit}` : text;
}

const VERDICT_LABEL: Record<CompareVerdict, string> = {
  regression: 'REGRESSION',
  improvement: 'improvement',
  no_change: 'no change',
  insufficient_data: 'not enough data',
};

function formatTable(table: string[][]): string[] {
  const widths = table[0].map((_, col) => Math.max(...table.map((row) => row[col].length)));

  return table.map((row) => `  ${row.map((cell, col) => cell.padEnd(widths[col])).join('   ')}`.trimEnd());
}

/** Report for a run without a baseline: the candidate's own stats. */
function formatStatsOnly(report: BenchReport): string {
  const rows = report.results.map((r) => {
    const s = r.candidate.stats;

    return [`${r.source === 'metric' ? 'metric ' : ''}${r.name}`, String(s.count), fmt(s.mean, s.unit), fmt(s.p50, s.unit), fmt(s.p95, s.unit), fmt(s.p99, s.unit)];
  });

  if (rows.length === 0) return `Run ${report.candidate}: no telemetry received.`;

  return [`Run ${report.candidate} (no baseline)`, '', ...formatTable([['name', 'count', 'mean', 'p50', 'p95', 'p99'], ...rows])].join('\n');
}

export function formatReport(report: BenchReport): string {
  if (report.baseline === null) return formatStatsOnly(report);

  if (report.results.length === 0) return `Comparing ${report.baseline} → ${report.candidate}: no telemetry received.`;

  const header = `Comparing ${report.baseline} → ${report.candidate} (${report.stat}, threshold ±${report.thresholdPct}%)`;

  const rows = report.results.map((r) => {
    const base = r.baseline.stats;
    const cand = r.candidate.stats;
    const unit = cand.unit ?? base.unit;
    const pct = r.deltas[r.stat].percent;

    return [
      `${r.source === 'metric' ? 'metric ' : ''}${r.name}`,
      fmt(base[r.stat], unit),
      fmt(cand[r.stat], unit),
      pct === null ? '' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
      VERDICT_LABEL[r.verdict],
      `n=${base.count}/${cand.count}`,
    ];
  });

  const lines = formatTable([['name', 'baseline', 'candidate', 'change', 'verdict', 'samples'], ...rows]);

  const notes = report.results.flatMap((r) => r.notes.map((n) => `  - ${r.name}: ${n}`));
  const totals = `${report.regressions} regression(s), ${report.improvements} improvement(s), ${report.unchanged} unchanged, ${report.insufficient} without enough data`;

  return [header, '', ...lines, '', totals, ...(notes.length ? ['', 'Notes:', ...notes] : [])].join('\n');
}

// ──────── entry point ────────

export async function bench(opts: BenchOptions): Promise<BenchReport> {
  if (opts.baselineRef && opts.against) throw new BenchError('use either --baseline or --against, not both');

  const candidateDir = resolve(opts.cwd);
  let baselinePhase: Phase | null = null;
  let saved: BenchFile | null = null;

  if (opts.against) saved = readBenchFile(resolve(opts.against));

  if (opts.baselineRef) {
    const checkout = checkoutBaseline(opts);

    log(`baseline ${opts.baselineRef} checked out at ${checkout.cwd}`);

    try {
      baselinePhase = await runPhase(opts, checkout.label, checkout.cwd);
    } finally {
      checkout.cleanup();
    }
  }

  const candidate = await runPhase(opts, candidateLabel(candidateDir), candidateDir);
  const db = getDatabase();

  const spanNames = opts.spans ?? [
    ...new Set([
      ...(baselinePhase ? db.listSpanNames(baselinePhase.selector) : []),
      ...(saved ? Object.keys(saved.spans) : []),
      ...db.listSpanNames(candidate.selector),
    ]),
  ];

  if (spanNames.length === 0 && opts.metrics.length === 0) {
    log(`no spans were received. Is the program exporting OTLP to $OTEL_EXPORTER_OTLP_ENDPOINT (${opts.url})?`);
  }

  const targets: Array<{ source: CompareSource; name: string }> = [
    ...spanNames.map((name) => ({ source: 'span' as const, name })),
    ...opts.metrics.map((name) => ({ source: 'metric' as const, name })),
  ];

  if (opts.save) {
    const file: BenchFile = {
      format: BENCH_FILE_FORMAT,
      label: candidate.label,
      createdAt: new Date().toISOString(),
      command: opts.run,
      spans: {},
      metrics: {},
    };

    for (const t of targets) {
      const stats = statsFor(t.source, t.name, candidate, []);

      if (stats.count > 0) (t.source === 'span' ? file.spans : file.metrics)[t.name] = stats;
    }

    writeFileSync(resolve(opts.save), `${JSON.stringify(file, null, 2)}\n`);
    log(`saved ${Object.keys(file.spans).length} span(s) and ${Object.keys(file.metrics).length} metric(s) to ${opts.save}`);
  }

  const empty = summarizeRun(db, 'span', '\u0000none', { since: 0, until: 0 }, '');
  const baselineLabel = baselinePhase?.label ?? saved?.label ?? null;
  const results: CompareResult[] = [];

  for (const t of targets) {
    let stats = empty; // no baseline: the candidate is reported on its own

    if (baselinePhase) stats = statsFor(t.source, t.name, baselinePhase, []);
    else if (saved) stats = (t.source === 'span' ? saved.spans : saved.metrics)[t.name] ?? empty;

    results.push(compareOne(opts, t.source, t.name, { label: baselineLabel ?? 'none', stats }, candidate));
  }

  const report = summarize(opts, baselineLabel, candidate.label, results);

  // A run without any baseline is informational: fine as long as telemetry arrived.
  if (!baselinePhase && !saved) {
    report.exitCode = results.some((r) => r.candidate.stats.count > 0) ? EXIT_OK : EXIT_INSUFFICIENT;
    report.insufficient = 0;

    for (const r of results) r.notes = r.notes.filter((n) => !n.startsWith('Need at least'));
  }

  return report;
}
