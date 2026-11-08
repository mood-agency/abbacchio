import type { Context } from 'hono';
import { getDatabase, type RunSelector } from '../lib/database.js';
import {
  COMPARE_STATS,
  compareRuns,
  isCompareDirection,
  isCompareSource,
  isCompareStat,
} from '../lib/compare.js';

function parseNumber(raw: string | undefined, field: string): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);

  if (!Number.isFinite(n)) throw new Error(`"${field}" must be a number`);

  return n;
}

function parseSelector(c: Context, prefix: 'baseline' | 'candidate'): RunSelector {
  const sel: RunSelector = {};
  const channel = c.req.query(`${prefix}Channel`) || c.req.query('channel');
  const version = c.req.query(`${prefix}Version`);
  const since = parseNumber(c.req.query(`${prefix}Since`), `${prefix}Since`);
  const until = parseNumber(c.req.query(`${prefix}Until`), `${prefix}Until`);

  if (channel) sel.channel = channel;

  if (version) sel.version = version;

  if (since !== undefined) sel.since = since;

  if (until !== undefined) sel.until = until;

  return sel;
}

/**
 * GET /api/compare - Compare a span or metric between two runs.
 *
 * Query params:
 *   - source: "span" (durations of spans named `name`) or "metric" (data points of metric `name`)
 *   - name: span or metric name (exact match)
 *   - channel: channel applied to both runs (optional)
 *   - baselineVersion / candidateVersion: `service.version` of each run
 *   - baselineChannel / candidateChannel: per-run channel (overrides `channel`)
 *   - baselineSince / baselineUntil / candidateSince / candidateUntil: epoch-ms bounds
 *   - stat: mean | p50 | p90 | p95 | p99 | max (default p95) — what the verdict is based on
 *   - threshold: percent change that counts as a difference (default 10)
 *   - direction: "lower" (default; latency) or "higher" (throughput) is better
 *   - minSamples: minimum observations per run (default 5)
 */
export function compareRunsHandler(c: Context) {
  try {
    const source = c.req.query('source') ?? '';

    if (!isCompareSource(source)) {
      return c.json({ error: '"source" must be "span" or "metric"' }, 400);
    }

    const name = c.req.query('name');

    if (!name) return c.json({ error: 'Missing "name"' }, 400);

    const baseline = parseSelector(c, 'baseline');
    const candidate = parseSelector(c, 'candidate');

    const identifies = (s: RunSelector) =>
      s.version !== undefined || s.since !== undefined || s.until !== undefined || s.channel !== undefined;

    if (!identifies(baseline) || !identifies(candidate)) {
      return c.json({ error: 'Each run needs a version, channel or time range (e.g. baselineVersion & candidateVersion)' }, 400);
    }

    if (JSON.stringify(baseline) === JSON.stringify(candidate)) {
      return c.json({ error: 'Baseline and candidate select the same data; give them different versions, channels or time ranges' }, 400);
    }

    const stat = c.req.query('stat') || 'p95';

    if (!isCompareStat(stat)) {
      return c.json({ error: `"stat" must be one of ${COMPARE_STATS.join(', ')}` }, 400);
    }

    const direction = c.req.query('direction') || 'lower';

    if (!isCompareDirection(direction)) {
      return c.json({ error: '"direction" must be "lower" or "higher"' }, 400);
    }

    const thresholdPct = parseNumber(c.req.query('threshold'), 'threshold') ?? 10;

    if (thresholdPct < 0) return c.json({ error: '"threshold" must be >= 0' }, 400);
    const minSamples = parseNumber(c.req.query('minSamples'), 'minSamples') ?? 5;

    if (minSamples < 1) return c.json({ error: '"minSamples" must be >= 1' }, 400);

    const result = compareRuns(getDatabase(), {
      source,
      name,
      baseline,
      candidate,
      stat,
      thresholdPct,
      direction,
      minSamples,
    });

    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    return c.json({ error: message }, 400);
  }
}

/**
 * GET /api/versions - Distinct `service.version` values seen, per channel.
 * Query params:
 *   - channel: restrict to one channel (optional)
 */
export function getVersions(c: Context) {
  const channel = c.req.query('channel') || undefined;

  return c.json({ versions: getDatabase().listVersions(channel) });
}
