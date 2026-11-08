import { describe, it, expect, mock, afterEach } from 'bun:test';
import { parseKeyValueList, readOtelEnv } from '../otel-env.js';
import { createClient } from '../index.js';

const OTEL_KEYS = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_SERVICE_NAME',
  'OTEL_RESOURCE_ATTRIBUTES',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_SDK_DISABLED',
];

afterEach(() => {
  for (const k of OTEL_KEYS) delete process.env[k];
});

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: any;
}

function captureFetch(): Captured[] {
  const calls: Captured[] = [];

  // @ts-expect-error — mock global fetch
  globalThis.fetch = mock(async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });

    return new Response('{}', { status: 200 });
  });

  return calls;
}

function resourceOf(call: Captured): Record<string, string> {
  const attrs = call.body.resourceLogs[0].resource.attributes as Array<{ key: string; value: { stringValue: string } }>;

  return Object.fromEntries(attrs.map((a) => [a.key, a.value.stringValue]));
}

describe('parseKeyValueList', () => {
  it('parses comma-separated pairs, trims and percent-decodes', () => {
    expect(parseKeyValueList(' a=1 , b = two%20words,bad,=x,c=k=v')).toEqual({ a: '1', b: 'two words', c: 'k=v' });
    expect(parseKeyValueList(undefined)).toEqual({});
  });
});

describe('readOtelEnv', () => {
  it('reads endpoint, service name, resource attributes and headers', () => {
    const cfg = readOtelEnv({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4100/',
      OTEL_RESOURCE_ATTRIBUTES: 'service.name=from-attrs,service.version=abc123',
      OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=secret',
    });

    expect(cfg.endpoint).toBe('http://localhost:4100');
    expect(cfg.serviceName).toBe('from-attrs');
    expect(cfg.resourceAttributes).toEqual({ 'service.version': 'abc123' });
    expect(cfg.headers).toEqual({ 'x-api-key': 'secret' });
    expect(cfg.disabled).toBe(false);
  });

  it('prefers OTEL_SERVICE_NAME over service.name in the attributes', () => {
    expect(readOtelEnv({ OTEL_SERVICE_NAME: 'svc', OTEL_RESOURCE_ATTRIBUTES: 'service.name=other' }).serviceName).toBe('svc');
  });

  it('honours OTEL_SDK_DISABLED', () => {
    expect(readOtelEnv({ OTEL_SDK_DISABLED: 'TRUE' }).disabled).toBe(true);
  });
});

describe('AbbacchioClient with OTEL_* env', () => {
  it('uses the env as defaults', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4100';
    process.env.OTEL_SERVICE_NAME = 'shop';
    process.env.OTEL_RESOURCE_ATTRIBUTES = 'service.version=abc123';
    process.env.OTEL_EXPORTER_OTLP_HEADERS = 'x-api-key=secret';
    const calls = captureFetch();

    const client = createClient({ batchSize: 1, maxPointsPerSecond: 0 });
    client.add({ level: 30, msg: 'hello' });
    await client.close();

    expect(calls[0].url).toBe('http://localhost:4100/v1/logs');
    expect(calls[0].headers['x-api-key']).toBe('secret');
    expect(resourceOf(calls[0])).toMatchObject({ 'service.name': 'shop', 'service.version': 'abc123' });
  });

  it('lets explicit options win over the env', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4100';
    process.env.OTEL_SERVICE_NAME = 'shop';
    process.env.OTEL_RESOURCE_ATTRIBUTES = 'service.version=env,deployment.environment=ci';
    const calls = captureFetch();

    const client = createClient({
      endpoint: 'http://localhost:4200',
      serviceName: 'explicit',
      resourceAttributes: { 'service.version': 'option' },
      batchSize: 1,
      maxPointsPerSecond: 0,
    });

    client.add({ level: 30, msg: 'hello' });
    await client.close();

    expect(calls[0].url).toBe('http://localhost:4200/v1/logs');
    expect(resourceOf(calls[0])).toMatchObject({
      'service.name': 'explicit',
      'service.version': 'option',
      'deployment.environment': 'ci',
    });
  });

  it('ignores the env with readEnv: false, and stays silent with OTEL_SDK_DISABLED', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4100';
    let calls = captureFetch();
    let client = createClient({ readEnv: false, batchSize: 1, maxPointsPerSecond: 0 });
    client.add({ level: 30, msg: 'hello' });
    await client.close();
    expect(calls[0].url).toBe('http://localhost:4000/v1/logs');

    process.env.OTEL_SDK_DISABLED = 'true';
    calls = captureFetch();
    client = createClient({ batchSize: 1, maxPointsPerSecond: 0 });
    client.add({ level: 30, msg: 'hello' });
    await client.close();
    expect(calls).toHaveLength(0);
  });
});
