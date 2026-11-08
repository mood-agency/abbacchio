import { describe, it, expect } from 'bun:test';
import { createTestApp } from '../helpers/test-app.js';

type Attr = { key: string; value: Record<string, unknown> };

const resource = (version: string, serviceName = 'bench-app'): { attributes: Attr[] } => ({
  attributes: [
    { key: 'service.name', value: { stringValue: serviceName } },
    { key: 'service.version', value: { stringValue: version } },
    { key: 'host.name', value: { stringValue: 'sandbox' } },
  ],
});

const BASE_NANO = 1_700_000_000_000_000_000n;

function spanRequest(version: string, durationsMs: number[], name = 'GET /users', errorEvery = 0) {
  return {
    resourceSpans: [{
      resource: resource(version),
      scopeSpans: [{
        spans: durationsMs.map((d, i) => {
          const start = BASE_NANO + BigInt(i) * 1_000_000_000n;

          return {
            traceId: `${version}-trace-${i}`,
            spanId: `${version}-span-${i}`,
            name,
            startTimeUnixNano: String(start),
            endTimeUnixNano: String(start + BigInt(Math.round(d * 1_000_000))),
            attributes: [],
            ...(errorEvery && i % errorEvery === 0 ? { status: { code: 2 } } : {}),
          };
        }),
      }],
    }],
  };
}

function histogramRequest(version: string, sum: number, count: number, bucketCounts: number[]) {
  return {
    resourceMetrics: [{
      resource: resource(version),
      scopeMetrics: [{
        metrics: [{
          name: 'http.server.duration',
          unit: 'ms',
          histogram: {
            dataPoints: [{
              timeUnixNano: String(BASE_NANO),
              sum,
              count: String(count),
              bucketCounts: bucketCounts.map(String),
              explicitBounds: [10, 50, 100, 500],
              attributes: [],
            }],
          },
        }],
      }],
    }],
  };
}

async function post(app: ReturnType<typeof createTestApp>, path: string, body: unknown) {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  expect(res.status).toBe(200);
}

const range = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));

describe('resource attributes', () => {
  it('copies service.version onto spans but drops other resource attributes', async () => {
    const app = createTestApp();
    await post(app, '/v1/traces', spanRequest('1.0.0', [10]));
    const res = await app.request('/api/traces?channel=bench-app');
    const json = await res.json();
    expect(json.traces[0].attributes['service.version']).toBe('1.0.0');
    expect(json.traces[0].attributes['host.name']).toBeUndefined();
  });
});

describe('GET /api/versions', () => {
  it('lists versions seen per channel', async () => {
    const app = createTestApp();
    await post(app, '/v1/traces', spanRequest('1.0.0', [10, 12]));
    await post(app, '/v1/traces', spanRequest('1.1.0', [11]));
    await post(app, '/v1/metrics', histogramRequest('1.1.0', 100, 4, [0, 4, 0, 0, 0]));

    const res = await app.request('/api/versions?channel=bench-app');
    expect(res.status).toBe(200);
    const { versions } = await res.json();
    const byVersion = Object.fromEntries(versions.map((v: any) => [v.version, v]));
    expect(byVersion['1.0.0'].spans).toBe(2);
    expect(byVersion['1.1.0'].spans).toBe(1);
    expect(byVersion['1.1.0'].metricPoints).toBe(1);
  });
});

describe('GET /api/compare', () => {
  it('detects a span latency regression between versions', async () => {
    const app = createTestApp();
    await post(app, '/v1/traces', spanRequest('1.0.0', range(50, (i) => 100 + (i % 5))));
    await post(app, '/v1/traces', spanRequest('1.1.0', range(50, (i) => 150 + (i % 5)), 'GET /users', 10));

    const res = await app.request(
      '/api/compare?source=span&name=GET%20/users&channel=bench-app&baselineVersion=1.0.0&candidateVersion=1.1.0',
    );

    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.verdict).toBe('regression');
    expect(r.stat).toBe('p95');
    expect(r.baseline.stats.count).toBe(50);
    expect(r.candidate.stats.count).toBe(50);
    expect(r.deltas.p95.percent).toBeGreaterThan(40);
    expect(r.candidate.stats.errorRate).toBeCloseTo(0.1);
    expect(r.notes.some((n: string) => n.includes('Error rate rose'))).toBe(true);
  });

  it('reports no change within the threshold', async () => {
    const app = createTestApp();
    await post(app, '/v1/traces', spanRequest('a', range(20, () => 100)));
    await post(app, '/v1/traces', spanRequest('b', range(20, () => 104)));
    const res = await app.request('/api/compare?source=span&name=GET%20/users&baselineVersion=a&candidateVersion=b&threshold=5');
    const r = await res.json();
    expect(r.verdict).toBe('no_change');
  });

  it('compares histogram metrics using persisted buckets', async () => {
    const app = createTestApp();
    // baseline: 100 requests all in (10, 50]; candidate: all in (50, 100]
    await post(app, '/v1/metrics', histogramRequest('1.0.0', 3000, 100, [0, 100, 0, 0, 0]));
    await post(app, '/v1/metrics', histogramRequest('1.1.0', 7500, 100, [0, 0, 100, 0, 0]));

    const res = await app.request(
      '/api/compare?source=metric&name=http.server.duration&baselineVersion=1.0.0&candidateVersion=1.1.0&stat=mean',
    );

    const r = await res.json();
    expect(r.baseline.stats.count).toBe(100);
    expect(r.baseline.stats.mean).toBe(30);
    expect(r.candidate.stats.mean).toBe(75);
    expect(r.candidate.stats.p50).toBe(75);
    expect(r.verdict).toBe('regression');
  });

  it('treats higher-is-better metrics correctly', async () => {
    const app = createTestApp();
    await post(app, '/v1/traces', spanRequest('a', range(10, () => 100)));
    await post(app, '/v1/traces', spanRequest('b', range(10, () => 50)));
    const res = await app.request('/api/compare?source=span&name=GET%20/users&baselineVersion=a&candidateVersion=b&direction=higher&stat=mean');
    expect((await res.json()).verdict).toBe('regression');
  });

  it('returns insufficient_data when a run is empty', async () => {
    const app = createTestApp();
    await post(app, '/v1/traces', spanRequest('a', range(10, () => 100)));
    const res = await app.request('/api/compare?source=span&name=GET%20/users&baselineVersion=a&candidateVersion=missing');
    const r = await res.json();
    expect(r.verdict).toBe('insufficient_data');
    expect(r.candidate.stats.count).toBe(0);
  });

  it('validates parameters', async () => {
    const app = createTestApp();

    const cases = [
      '/api/compare?name=x&baselineVersion=a&candidateVersion=b',
      '/api/compare?source=span&baselineVersion=a&candidateVersion=b',
      '/api/compare?source=span&name=x&baselineVersion=a',
      '/api/compare?source=span&name=x&baselineVersion=a&candidateVersion=a',
      '/api/compare?source=span&name=x&baselineVersion=a&candidateVersion=b&stat=p42',
      '/api/compare?source=span&name=x&baselineVersion=a&candidateVersion=b&threshold=abc',
      '/api/compare?source=span&name=x&baselineVersion=a&candidateVersion=b&direction=up',
    ];

    for (const path of cases) {
      const res = await app.request(path);
      expect(res.status).toBe(400);
    }
  });
});
