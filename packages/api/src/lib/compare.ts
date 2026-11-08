/**
 * Compare two runs of the same span or metric (e.g. a baseline version vs a
 * candidate version) and decide whether the candidate regressed.
 *
 * Pure functions only: the database layer selects the samples
 * (LogDatabase.selectSpanSamples / selectMetricSamples) and this module turns
 * them into summary statistics and a verdict.
 */

import type { MetricSample, RunSelector, SpanSample } from './database.js';

export type CompareSource = 'span' | 'metric';
export type CompareStat = 'mean' | 'p50' | 'p90' | 'p95' | 'p99' | 'max';
/** Which way is "better": `lower` for latencies/memory, `higher` for throughput. */
export type CompareDirection = 'lower' | 'higher';
export type CompareVerdict = 'regression' | 'improvement' | 'no_change' | 'insufficient_data';

export const COMPARE_STATS: readonly CompareStat[] = ['mean', 'p50', 'p90', 'p95', 'p99', 'max'];

export interface RunStats {
  /** Number of observations (span count, raw data points, or histogram total count). */
  count: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  /** Spans only: fraction of spans with status ERROR. */
  errorRate?: number;
  unit: string | null;
}

export interface StatDelta {
  baseline: number | null;
  candidate: number | null;
  /** candidate - baseline */
  absolute: number | null;
  /** Percent change relative to baseline; null when baseline is 0 or missing. */
  percent: number | null;
}

export interface CompareOptions {
  source: CompareSource;
  name: string;
  baseline: RunSelector;
  candidate: RunSelector;
  /** Statistic the verdict is based on. Default p95. */
  stat?: CompareStat;
  /** Percent change that counts as a real difference. Default 10. */
  thresholdPct?: number;
  direction?: CompareDirection;
  /** Minimum observations per side before a verdict is given. Default 5. */
  minSamples?: number;
}

export interface CompareResult {
  source: CompareSource;
  name: string;
  stat: CompareStat;
  thresholdPct: number;
  direction: CompareDirection;
  minSamples: number;
  baseline: { selector: RunSelector; stats: RunStats };
  candidate: { selector: RunSelector; stats: RunStats };
  deltas: Record<CompareStat, StatDelta> & { errorRate?: StatDelta };
  verdict: CompareVerdict;
  /** One-line human-readable explanation of the verdict. */
  summary: string;
  /** Caveats: truncation, error-rate changes, estimated percentiles, ... */
  notes: string[];
}

// ──────── STATISTICS ────────

/** Linear-interpolated percentile of an ascending-sorted array (q in [0, 1]). */
export function percentile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function emptyStats(unit: string | null): RunStats {
  return { count: 0, mean: null, min: null, max: null, p50: null, p90: null, p95: null, p99: null, unit };
}

/** Summary statistics over raw observations. */
export function summarizeValues(values: number[], unit: string | null = null): RunStats {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return emptyStats(unit);
  const sorted = [...finite].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    mean: sum / sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    unit,
  };
}

/**
 * Estimate a percentile from OTLP explicit-bucket histogram counts.
 * Bucket i covers (bounds[i-1], bounds[i]]; values are assumed uniformly
 * spread inside a bucket. The overflow bucket (> last bound) has no upper
 * edge, so estimates landing there are clamped to the last bound.
 */
export function histogramPercentile(bucketCounts: number[], bounds: number[], q: number): number | null {
  const total = bucketCounts.reduce((acc, c) => acc + c, 0);
  if (total === 0) return null;
  const rank = q * total;
  let cumulative = 0;
  for (let i = 0; i < bucketCounts.length; i++) {
    const c = bucketCounts[i];
    if (c === 0) continue;
    if (cumulative + c >= rank) {
      if (i >= bounds.length) return bounds.length > 0 ? bounds[bounds.length - 1] : null;
      const upper = bounds[i];
      const lower = i === 0 ? Math.min(0, upper) : bounds[i - 1];
      const fraction = (rank - cumulative) / c;
      return lower + (upper - lower) * fraction;
    }
    cumulative += c;
  }
  return bounds.length > 0 ? bounds[bounds.length - 1] : null;
}

export function summarizeSpans(samples: SpanSample[]): RunStats {
  const stats = summarizeValues(samples.map((s) => s.durationMs), 'ms');
  stats.errorRate = samples.length === 0 ? 0 : samples.filter((s) => s.error).length / samples.length;
  return stats;
}

/**
 * Summary statistics for metric data points.
 * Gauge/Sum points are treated as raw observations. Histogram points are
 * merged: the mean is exact (Σsum / Σcount) and percentiles are estimated from
 * the merged buckets when every point shares the same bounds.
 */
export function summarizeMetric(samples: MetricSample[], notes: string[] = []): RunStats {
  const unit = samples.find((s) => s.unit)?.unit ?? null;
  if (samples.length === 0) return emptyStats(unit);

  const histograms = samples.filter((s) => s.type === 'Histogram');
  if (histograms.length === 0) {
    return summarizeValues(samples.map((s) => s.value), unit);
  }
  if (histograms.length !== samples.length) {
    notes.push('Metric mixes Histogram and non-Histogram points; only Histogram points were used.');
  }

  const totalCount = histograms.reduce((acc, s) => acc + (s.count ?? 0), 0);
  const totalSum = histograms.reduce((acc, s) => acc + s.value, 0);
  const stats = emptyStats(unit);
  stats.count = totalCount;
  stats.mean = totalCount > 0 ? totalSum / totalCount : null;

  const withBuckets = histograms.filter((s) => s.bucketCounts && s.explicitBounds);
  if (withBuckets.length === 0) {
    notes.push('Histogram points carry no buckets; only the mean is available.');
    return stats;
  }
  const bounds = withBuckets[0].explicitBounds!;
  const key = JSON.stringify(bounds);
  if (withBuckets.length !== histograms.length || withBuckets.some((s) => JSON.stringify(s.explicitBounds) !== key)) {
    notes.push('Histogram points have differing or missing bucket bounds; percentiles are not available.');
    return stats;
  }

  const merged: number[] = Array.from({ length: bounds.length + 1 }, () => 0);
  for (const s of withBuckets) {
    s.bucketCounts!.forEach((c, i) => {
      if (i < merged.length) merged[i] += c;
    });
  }
  stats.p50 = histogramPercentile(merged, bounds, 0.5);
  stats.p90 = histogramPercentile(merged, bounds, 0.9);
  stats.p95 = histogramPercentile(merged, bounds, 0.95);
  stats.p99 = histogramPercentile(merged, bounds, 0.99);
  const lastNonEmpty = merged.reduce((last, c, i) => (c > 0 ? i : last), -1);
  if (lastNonEmpty >= 0) stats.max = lastNonEmpty < bounds.length ? bounds[lastNonEmpty] : null;
  notes.push('Histogram percentiles are estimated from bucket boundaries.');
  return stats;
}

// ──────── COMPARISON ────────

export function delta(baseline: number | null, candidate: number | null): StatDelta {
  if (baseline === null || candidate === null) {
    return { baseline, candidate, absolute: null, percent: null };
  }
  const absolute = candidate - baseline;
  const percent = baseline === 0 ? null : (absolute / Math.abs(baseline)) * 100;
  return { baseline, candidate, absolute, percent };
}

function fmt(n: number | null, unit: string | null): string {
  if (n === null) return 'n/a';
  const rounded = Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(2) : n.toPrecision(3);
  return unit ? `${rounded} ${unit}` : rounded;
}

export function decideVerdict(
  d: StatDelta,
  direction: CompareDirection,
  thresholdPct: number,
): CompareVerdict {
  if (d.baseline === null || d.candidate === null || d.absolute === null) return 'insufficient_data';
  if (d.percent === null) {
    // Baseline is exactly 0: any change is infinite in percent terms.
    if (d.absolute === 0) return 'no_change';
    const worse = direction === 'lower' ? d.absolute > 0 : d.absolute < 0;
    return worse ? 'regression' : 'improvement';
  }
  if (Math.abs(d.percent) <= thresholdPct) return 'no_change';
  const worse = direction === 'lower' ? d.percent > 0 : d.percent < 0;
  return worse ? 'regression' : 'improvement';
}

/** Build the comparison result from already-summarized runs. */
export function compareStats(
  opts: CompareOptions,
  baselineStats: RunStats,
  candidateStats: RunStats,
  notes: string[] = [],
): CompareResult {
  const stat = opts.stat ?? 'p95';
  const thresholdPct = opts.thresholdPct ?? 10;
  const direction = opts.direction ?? 'lower';
  const minSamples = opts.minSamples ?? 5;

  const deltas = Object.fromEntries(
    COMPARE_STATS.map((s) => [s, delta(baselineStats[s], candidateStats[s])]),
  ) as CompareResult['deltas'];

  if (baselineStats.errorRate !== undefined && candidateStats.errorRate !== undefined) {
    deltas.errorRate = delta(baselineStats.errorRate, candidateStats.errorRate);
    if (candidateStats.errorRate > baselineStats.errorRate) {
      notes.push(
        `Error rate rose from ${(baselineStats.errorRate * 100).toFixed(1)}% to ${(candidateStats.errorRate * 100).toFixed(1)}%.`,
      );
    }
  }

  let verdict: CompareVerdict;
  if (baselineStats.count < minSamples || candidateStats.count < minSamples) {
    verdict = 'insufficient_data';
    notes.push(
      `Need at least ${minSamples} observations per run (baseline ${baselineStats.count}, candidate ${candidateStats.count}).`,
    );
  } else {
    verdict = decideVerdict(deltas[stat], direction, thresholdPct);
  }

  const d = deltas[stat];
  const unit = candidateStats.unit ?? baselineStats.unit;
  const pct = d.percent === null ? '' : ` (${d.percent >= 0 ? '+' : ''}${d.percent.toFixed(1)}%)`;
  const summary =
    verdict === 'insufficient_data'
      ? `${opts.name}: not enough data to compare ${stat}.`
      : `${opts.name} ${stat}: ${fmt(d.baseline, unit)} → ${fmt(d.candidate, unit)}${pct} — ${verdict.replace('_', ' ')} ` +
        `(threshold ±${thresholdPct}%, ${direction} is better).`;

  return {
    source: opts.source,
    name: opts.name,
    stat,
    thresholdPct,
    direction,
    minSamples,
    baseline: { selector: opts.baseline, stats: baselineStats },
    candidate: { selector: opts.candidate, stats: candidateStats },
    deltas,
    verdict,
    summary,
    notes,
  };
}

/** Minimal slice of LogDatabase that compareRuns needs (keeps it testable). */
export interface CompareDataSource {
  selectSpanSamples(name: string, sel: RunSelector): { samples: SpanSample[]; truncated: boolean };
  selectMetricSamples(name: string, sel: RunSelector): { samples: MetricSample[]; truncated: boolean };
}

export function compareRuns(db: CompareDataSource, opts: CompareOptions): CompareResult {
  const notes: string[] = [];
  const summarize = (sel: RunSelector, label: string): RunStats => {
    if (opts.source === 'span') {
      const { samples, truncated } = db.selectSpanSamples(opts.name, sel);
      if (truncated) notes.push(`${label} run was truncated to the ${samples.length} most recent spans.`);
      return summarizeSpans(samples);
    }
    const { samples, truncated } = db.selectMetricSamples(opts.name, sel);
    if (truncated) notes.push(`${label} run was truncated to the ${samples.length} most recent data points.`);
    const metricNotes: string[] = [];
    const stats = summarizeMetric(samples, metricNotes);
    notes.push(...metricNotes.map((n) => `${label}: ${n}`));
    return stats;
  };

  const baselineStats = summarize(opts.baseline, 'Baseline');
  const candidateStats = summarize(opts.candidate, 'Candidate');
  return compareStats(opts, baselineStats, candidateStats, notes);
}
