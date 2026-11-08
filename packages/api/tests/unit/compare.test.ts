import { describe, it, expect } from 'bun:test';
import {
  compareStats,
  decideVerdict,
  delta,
  histogramPercentile,
  percentile,
  summarizeMetric,
  summarizeSpans,
  summarizeValues,
} from '../../src/lib/compare.js';
import { spreadPct } from '../../src/bench.js';
import type { MetricSample } from '../../src/lib/database.js';

describe('percentile', () => {
  it('interpolates linearly', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([10], 0.95)).toBe(10);
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([0, 100], 0.95)).toBe(95);
  });
});

describe('summarizeValues', () => {
  it('computes summary statistics and ignores non-finite values', () => {
    const s = summarizeValues([5, 1, 3, NaN, 2, 4], 'ms');
    expect(s.count).toBe(5);
    expect(s.mean).toBe(3);
    expect(s.min).toBe(1);
    expect(s.max).toBe(5);
    expect(s.p50).toBe(3);
    expect(s.unit).toBe('ms');
  });
});

describe('summarizeSpans', () => {
  it('reports error rate', () => {
    const s = summarizeSpans([
      { durationMs: 10, error: false },
      { durationMs: 20, error: true },
      { durationMs: 30, error: false },
      { durationMs: 40, error: false },
    ]);

    expect(s.errorRate).toBe(0.25);
    expect(s.mean).toBe(25);
  });
});

describe('histogramPercentile', () => {
  it('interpolates inside the bucket that holds the rank', () => {
    // buckets: (<=10]:0, (10,20]:10, (20,+inf):0
    expect(histogramPercentile([0, 10, 0], [10, 20], 0.5)).toBe(15);
  });

  it('clamps estimates in the overflow bucket to the last bound', () => {
    expect(histogramPercentile([0, 0, 5], [10, 20], 0.99)).toBe(20);
  });

  it('returns null for an empty histogram', () => {
    expect(histogramPercentile([0, 0], [10], 0.5)).toBeNull();
  });
});

describe('summarizeMetric', () => {
  const hist = (sum: number, count: number, buckets: number[], bounds = [10, 20, 50]): MetricSample => ({
    type: 'Histogram', unit: 'ms', value: sum, count, bucketCounts: buckets, explicitBounds: bounds,
  });

  it('merges histogram points: exact mean, estimated percentiles', () => {
    const notes: string[] = [];
    const s = summarizeMetric([hist(150, 10, [0, 10, 0, 0]), hist(150, 10, [0, 10, 0, 0])], notes);
    expect(s.count).toBe(20);
    expect(s.mean).toBe(15);
    expect(s.p50).toBe(15);
    expect(s.max).toBe(20);
    expect(notes.some((n) => n.includes('estimated'))).toBe(true);
  });

  it('gives only the mean when bucket bounds differ', () => {
    const notes: string[] = [];
    const s = summarizeMetric([hist(100, 10, [10, 0, 0, 0]), hist(100, 10, [10, 0, 0], [5, 10])], notes);
    expect(s.mean).toBe(10);
    expect(s.p95).toBeNull();
    expect(notes.some((n) => n.includes('differing'))).toBe(true);
  });

  it('treats gauge points as raw observations', () => {
    const gauge = (value: number): MetricSample => ({
      type: 'Gauge', unit: 'By', value, count: null, bucketCounts: null, explicitBounds: null,
    });

    const s = summarizeMetric([gauge(100), gauge(200), gauge(300)]);
    expect(s.count).toBe(3);
    expect(s.p50).toBe(200);
    expect(s.unit).toBe('By');
  });
});

describe('decideVerdict', () => {
  it('flags regressions beyond the threshold for lower-is-better', () => {
    expect(decideVerdict(delta(100, 120), 'lower', 10)).toBe('regression');
    expect(decideVerdict(delta(100, 80), 'lower', 10)).toBe('improvement');
    expect(decideVerdict(delta(100, 105), 'lower', 10)).toBe('no_change');
  });

  it('inverts for higher-is-better', () => {
    expect(decideVerdict(delta(100, 80), 'higher', 10)).toBe('regression');
    expect(decideVerdict(delta(100, 120), 'higher', 10)).toBe('improvement');
  });

  it('handles a zero baseline', () => {
    expect(decideVerdict(delta(0, 0), 'lower', 10)).toBe('no_change');
    expect(decideVerdict(delta(0, 5), 'lower', 10)).toBe('regression');
  });

  it('reports insufficient data when a side is missing', () => {
    expect(decideVerdict(delta(null, 5), 'lower', 10)).toBe('insufficient_data');
  });
});

describe('compareStats', () => {
  const opts = { source: 'span' as const, name: 'GET /users', baseline: { version: '1' }, candidate: { version: '2' } };

  it('requires minSamples on both sides', () => {
    const r = compareStats(opts, summarizeValues([1, 2, 3]), summarizeValues([1, 2, 3, 4, 5]));
    expect(r.verdict).toBe('insufficient_data');
  });

  it('builds a summary line with the chosen stat', () => {
    const base = summarizeValues(Array.from({ length: 20 }, () => 100), 'ms');
    const cand = summarizeValues(Array.from({ length: 20 }, () => 150), 'ms');
    const r = compareStats({ ...opts, stat: 'mean' }, base, cand);
    expect(r.verdict).toBe('regression');
    expect(r.deltas.mean.percent).toBe(50);
    expect(r.summary).toContain('+50.0%');
  });

  it('notes an error-rate increase', () => {
    const base = summarizeSpans(Array.from({ length: 10 }, () => ({ durationMs: 10, error: false })));
    const cand = summarizeSpans(Array.from({ length: 10 }, (_, i) => ({ durationMs: 10, error: i < 3 })));
    const r = compareStats(opts, base, cand);
    expect(r.verdict).toBe('no_change');
    expect(r.deltas.errorRate?.candidate).toBeCloseTo(0.3);
    expect(r.notes.some((n) => n.includes('Error rate rose'))).toBe(true);
  });
});

describe('spreadPct', () => {
  it('is (max - min) / median in percent, null with fewer than 2 values', () => {
    expect(spreadPct([10, 20, 10])).toBeCloseTo(100, 6);
    expect(spreadPct([10, 11, 12])).toBeCloseTo(18.18, 2);
    expect(spreadPct([5])).toBeNull();
    expect(spreadPct([0, 0])).toBeNull();
  });
});
