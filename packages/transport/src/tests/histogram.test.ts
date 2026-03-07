import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { createClient, type HistogramRecord } from '../index.js';

/**
 * Tests for addHistogram / sendHistograms on AbbacchioClient.
 *
 * We intercept fetch to capture the OTLP payload sent to /v1/metrics
 * and verify the histogram data point structure matches the OTLP spec.
 */

describe('AbbacchioClient.addHistogram', () => {
  let captured: any[] = [];

  beforeEach(() => {
    captured = [];
    // @ts-expect-error — mock global fetch
    globalThis.fetch = mock(async (_url: string, init: any) => {
      captured.push({ url: _url, body: JSON.parse(init.body) });
      return new Response('{}', { status: 200 });
    });
  });

  it('should send a single histogram observation as an OTLP Histogram data point', async () => {
    const client = createClient({ endpoint: 'http://test:4002', batchSize: 1 });

    client.addHistogram({
      name: 'http.duration',
      value: 42,
      unit: 'ms',
      attributes: { method: 'GET' },
    });

    // batchSize=1 triggers immediate flush
    await new Promise((r) => setTimeout(r, 50));

    expect(captured.length).toBe(1);
    const payload = captured[0].body;
    expect(captured[0].url).toBe('http://test:4002/v1/metrics');

    const metric = payload.resourceMetrics[0].scopeMetrics[0].metrics[0];
    expect(metric.name).toBe('http.duration');
    expect(metric.unit).toBe('ms');
    expect(metric.histogram).toBeDefined();
    expect(metric.histogram.aggregationTemporality).toBe(1); // DELTA

    const dp = metric.histogram.dataPoints[0];
    expect(dp.count).toBe(1);
    expect(dp.sum).toBe(42);
    expect(dp.min).toBe(42);
    expect(dp.max).toBe(42);

    // Should have default explicit bounds
    expect(dp.explicitBounds).toEqual([5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 10000]);
    // 14 buckets (13 bounds + 1 overflow)
    expect(dp.bucketCounts.length).toBe(14);

    // 42 falls into the bucket for ≤50 (index 3)
    expect(dp.bucketCounts[3]).toBe('1');
    // All other buckets should be 0
    const nonZero = dp.bucketCounts.filter((c: string) => c !== '0');
    expect(nonZero.length).toBe(1);

    // Check attributes are OTLP KeyValue format
    expect(dp.attributes).toEqual([
      { key: 'method', value: { stringValue: 'GET' } },
    ]);

    await client.close();
  });

  it('should aggregate multiple observations into one histogram data point', async () => {
    const client = createClient({ endpoint: 'http://test:4002', batchSize: 100 });

    const values = [3, 8, 15, 55, 120, 300, 8000];
    for (const v of values) {
      client.addHistogram({ name: 'latency', value: v, unit: 'ms' });
    }

    await client.flushHistograms();
    await new Promise((r) => setTimeout(r, 50));

    expect(captured.length).toBe(1);
    const dp = captured[0].body.resourceMetrics[0].scopeMetrics[0].metrics[0].histogram.dataPoints[0];

    expect(dp.count).toBe(7);
    expect(dp.sum).toBe(3 + 8 + 15 + 55 + 120 + 300 + 8000);
    expect(dp.min).toBe(3);
    expect(dp.max).toBe(8000);

    // Verify bucket placement with default bounds [5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 10000]
    // values: [3, 8, 15, 55, 120, 300, 8000]
    const counts = dp.bucketCounts.map(Number);
    expect(counts[0]).toBe(1);  // ≤5: value 3
    expect(counts[1]).toBe(1);  // ≤10: value 8
    expect(counts[2]).toBe(1);  // ≤25: value 15
    expect(counts[3]).toBe(0);  // ≤50: none (55 > 50)
    expect(counts[4]).toBe(1);  // ≤75: value 55
    expect(counts[6]).toBe(1);  // ≤250: value 120
    expect(counts[7]).toBe(1);  // ≤500: value 300
    expect(counts[12]).toBe(1); // ≤10000: value 8000

    await client.close();
  });

  it('should use custom explicit bounds when provided', async () => {
    const client = createClient({ endpoint: 'http://test:4002', batchSize: 100 });

    client.addHistogram({
      name: 'custom',
      value: 7,
      explicitBounds: [5, 10, 20],
    });
    client.addHistogram({
      name: 'custom',
      value: 15,
      explicitBounds: [5, 10, 20],
    });
    client.addHistogram({
      name: 'custom',
      value: 50,
      explicitBounds: [5, 10, 20],
    });

    await client.flushHistograms();
    await new Promise((r) => setTimeout(r, 50));

    const dp = captured[0].body.resourceMetrics[0].scopeMetrics[0].metrics[0].histogram.dataPoints[0];
    expect(dp.explicitBounds).toEqual([5, 10, 20]);
    expect(dp.bucketCounts.length).toBe(4); // 3 bounds + 1 overflow

    const counts = dp.bucketCounts.map(Number);
    expect(counts[0]).toBe(0);  // ≤5: none
    expect(counts[1]).toBe(1);  // ≤10: value 7
    expect(counts[2]).toBe(1);  // ≤20: value 15
    expect(counts[3]).toBe(1);  // >20: value 50

    await client.close();
  });

  it('should group observations by name+attributes into separate histogram data points', async () => {
    const client = createClient({ endpoint: 'http://test:4002', batchSize: 100 });

    client.addHistogram({ name: 'latency', value: 10, attributes: { route: '/api/a' } });
    client.addHistogram({ name: 'latency', value: 20, attributes: { route: '/api/a' } });
    client.addHistogram({ name: 'latency', value: 30, attributes: { route: '/api/b' } });

    await client.flushHistograms();
    await new Promise((r) => setTimeout(r, 50));

    const metrics = captured[0].body.resourceMetrics[0].scopeMetrics[0].metrics;
    expect(metrics.length).toBe(2); // Two groups: /api/a and /api/b

    const dpA = metrics.find((m: any) =>
      m.histogram.dataPoints[0].attributes.some((a: any) => a.value.stringValue === '/api/a')
    ).histogram.dataPoints[0];
    expect(dpA.count).toBe(2);
    expect(dpA.sum).toBe(30);

    const dpB = metrics.find((m: any) =>
      m.histogram.dataPoints[0].attributes.some((a: any) => a.value.stringValue === '/api/b')
    ).histogram.dataPoints[0];
    expect(dpB.count).toBe(1);
    expect(dpB.sum).toBe(30);

    await client.close();
  });

  it('should not send anything when disabled', async () => {
    const client = createClient({ endpoint: 'http://test:4002', enabled: false, batchSize: 1 });

    client.addHistogram({ name: 'test', value: 100 });
    await client.flushHistograms();
    await new Promise((r) => setTimeout(r, 50));

    expect(captured.length).toBe(0);
    await client.close();
  });

  it('should flush histograms on close()', async () => {
    const client = createClient({ endpoint: 'http://test:4002', batchSize: 100 });

    client.addHistogram({ name: 'test', value: 42 });
    await client.close();
    await new Promise((r) => setTimeout(r, 50));

    expect(captured.length).toBe(1);
    expect(captured[0].body.resourceMetrics[0].scopeMetrics[0].metrics[0].name).toBe('test');
  });
});
