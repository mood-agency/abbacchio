import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { createClient } from '../index.js';

/**
 * Regression tests for the runaway-producer protections added to AbbacchioClient:
 *  - intake throttle (maxPointsPerSecond) — drops excess points locally
 *  - buffer cap (maxBufferSize) — bounds memory
 *  - 429 backoff — pauses flushing instead of hammering the server
 *
 * These cover the "ffprobe streamed one metric per line → hundreds of 429s" flood.
 */
describe('AbbacchioClient runaway-producer protections', () => {
  let calls: { url: string; body: any }[] = [];
  let nextStatus = 200;
  let nextHeaders: Record<string, string> = {};

  beforeEach(() => {
    calls = [];
    nextStatus = 200;
    nextHeaders = {};
    // @ts-expect-error — mock global fetch
    globalThis.fetch = mock(async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response('{}', { status: nextStatus, headers: nextHeaders });
    });
  });

  const countPoints = () =>
    calls
      .filter((c) => c.url.endsWith('/v1/metrics'))
      .reduce(
        (n, c) =>
          n +
          c.body.resourceMetrics[0].scopeMetrics[0].metrics.reduce(
            (m: number, metric: any) =>
              m + (metric.sum?.dataPoints?.length ?? metric.gauge?.dataPoints?.length ?? 0),
            0,
          ),
        0,
      );

  it('drops points beyond maxPointsPerSecond instead of sending them all', async () => {
    const client = createClient({
      endpoint: 'http://test:4002',
      batchSize: 1,
      maxPointsPerSecond: 5,
    });

    // Emit 100 points in a tight loop (the ffprobe-per-line scenario).
    for (let i = 0; i < 100; i++) {
      client.addMetric({ name: 'progress', type: 'gauge', value: i });
    }
    await client.flush();

    // Only the ~5 admitted points should ever reach the wire; the rest dropped.
    expect(countPoints()).toBeLessThanOrEqual(5);
    expect(countPoints()).toBeGreaterThan(0);
  });

  it('caps the buffer at maxBufferSize so a flush cannot send unbounded points', async () => {
    const client = createClient({
      endpoint: 'http://test:4002',
      batchSize: 1_000_000, // never auto-flush; let the buffer fill
      maxPointsPerSecond: 0, // disable intake throttle to isolate the cap
      maxBufferSize: 10,
    });

    for (let i = 0; i < 1000; i++) {
      client.addMetric({ name: 'progress', type: 'gauge', value: i });
    }
    await client.flush();

    expect(countPoints()).toBeLessThanOrEqual(10);
  });

  it('pauses sending after a 429 (honoring Retry-After) instead of hammering', async () => {
    const client = createClient({
      endpoint: 'http://test:4002',
      batchSize: 1,
      maxPointsPerSecond: 0,
    });

    // First send gets rate-limited with a long Retry-After.
    nextStatus = 429;
    nextHeaders = { 'Retry-After': '60' };
    client.addMetric({ name: 'progress', type: 'gauge', value: 1 });
    await client.flush();
    const callsAfter429 = calls.length;
    expect(callsAfter429).toBe(1);

    // Server would now accept, but we are paused: further flushes must not hit the wire.
    nextStatus = 200;
    for (let i = 0; i < 20; i++) {
      client.addMetric({ name: 'progress', type: 'gauge', value: i });
    }
    await client.flush();

    expect(calls.length).toBe(callsAfter429); // still paused — no new requests
  });

  it('re-sends a batch that was rate-limited instead of dropping it', async () => {
    const client = createClient({ endpoint: 'http://test:4002', batchSize: 1, maxPointsPerSecond: 0 });

    nextStatus = 429;
    nextHeaders = { 'Retry-After': '60' };
    client.addMetric({ name: 'progress', type: 'gauge', value: 42 });
    await client.flush();
    expect(calls.length).toBe(1);

    // close() must deliver the rate-limited point even though we are still paused.
    nextStatus = 200;
    await client.close();

    expect(calls.length).toBe(2);
    expect(countPoints()).toBe(2); // the 429'd attempt + the successful retry
    const lastPoint = calls[1].body.resourceMetrics[0].scopeMetrics[0].metrics[0].gauge.dataPoints[0];
    expect(lastPoint.asDouble ?? lastPoint.asInt).toBe(42);
  });

  it('close() sends buffered logs while paused instead of resolving early', async () => {
    const client = createClient({ endpoint: 'http://test:4002', batchSize: 100, maxPointsPerSecond: 0 });

    nextStatus = 429;
    nextHeaders = { 'Retry-After': '60' };
    client.add({ level: 30, msg: 'first' });
    await client.flush();
    expect(calls.length).toBe(1);

    nextStatus = 200;
    client.add({ level: 30, msg: 'second' });
    await client.close();

    const logCalls = calls.filter((c) => c.url.endsWith('/v1/logs'));
    expect(logCalls.length).toBe(2);
    const bodies = logCalls[1].body.resourceLogs[0].scopeLogs[0].logRecords.map((r: any) => r.body.stringValue);
    expect(bodies).toEqual(['first', 'second']);
  });
});

