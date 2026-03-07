import { describe, it, expect } from 'bun:test';
import { createTestApp } from '../helpers/test-app.js';
import {
  createOtlpLogRequest,
  createOtlpLogBatch,
  createPinoOtelLogRequest,
  createOtlpMetricRequest,
  createOtlpTraceRequest,
  emptyOtlpLogRequest,
  emptyOtlpMetricRequest,
  emptyOtlpTraceRequest,
} from '../helpers/otlp-fixtures.js';
import { getLogBuffer } from '../../src/lib/log-buffer.js';
import { getMetricBuffer } from '../../src/lib/metric-buffer.js';
import { getTraceBuffer } from '../../src/lib/trace-buffer.js';

describe('POST /v1/logs (OTLP)', () => {
  it('should accept an OTLP log request and return 200', async () => {
    const app = createTestApp();
    const request = createOtlpLogRequest({ body: 'Hello from OTLP' });

    const response = await app.request('/v1/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({});
  });

  it('should register channel and update log count', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    const request = createOtlpLogRequest({
      body: 'Stored OTLP log',
      severityNumber: 13,
      serviceName: 'otlp-test',
    });

    await app.request('/v1/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    expect(buffer.getChannels()).toContain('otlp-test');
    const channelInfo = buffer.getChannelInfo('otlp-test');
    expect(channelInfo).toBeDefined();
    expect(channelInfo!.logCount).toBe(1);
  });

  it('should handle batch OTLP logs and update count', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    const request = createOtlpLogBatch(5, 'batch-app');

    const response = await app.request('/v1/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(200);
    expect(buffer.getChannels()).toContain('batch-app');
    expect(buffer.getChannelInfo('batch-app')!.logCount).toBe(5);
  });

  it('should use X-Channel header as fallback when no service.name', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    const request: any = {
      resourceLogs: [{
        resource: { attributes: [] },
        scopeLogs: [{
          logRecords: [{
            severityNumber: 9,
            body: { stringValue: 'fallback channel' },
          }],
        }],
      }],
    };

    await app.request('/v1/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Channel': 'header-channel',
      },
      body: JSON.stringify(request),
    });

    expect(buffer.getChannels()).toContain('header-channel');
    expect(buffer.getChannelInfo('header-channel')!.logCount).toBe(1);
  });

  it('should handle pino-opentelemetry-transport log with service.name as channel', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    const request = createPinoOtelLogRequest({
      msg: 'User logged in',
      level: 'info',
      serviceName: 'pino-otel-app',
      attributes: { userId: 42, action: 'login' },
    });

    const response = await app.request('/v1/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(200);
    expect(buffer.getChannels()).toContain('pino-otel-app');
    expect(buffer.getChannelInfo('pino-otel-app')!.logCount).toBe(1);
  });

  it('should handle empty OTLP log request', async () => {
    const app = createTestApp();

    const response = await app.request('/v1/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emptyOtlpLogRequest),
    });

    expect(response.status).toBe(200);
  });

  it('should return 400 for invalid JSON', async () => {
    const app = createTestApp();

    const response = await app.request('/v1/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json',
    });

    expect(response.status).toBe(400);
  });

  it('should handle multiple services in a single request', async () => {
    const app = createTestApp();
    const buffer = getLogBuffer();

    const request: any = {
      resourceLogs: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'service-a' } }] },
          scopeLogs: [{ logRecords: [{ severityNumber: 9, body: { stringValue: 'from A' } }] }],
        },
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'service-b' } }] },
          scopeLogs: [{ logRecords: [{ severityNumber: 13, body: { stringValue: 'from B' } }] }],
        },
      ],
    };

    const response = await app.request('/v1/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(200);
    expect(buffer.getChannels()).toContain('service-a');
    expect(buffer.getChannels()).toContain('service-b');
  });
});

describe('POST /v1/metrics (OTLP)', () => {
  it('should accept an OTLP metrics request and return 200', async () => {
    const app = createTestApp();
    const request = createOtlpMetricRequest();

    const response = await app.request('/v1/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  it('should store metrics in the metric buffer', async () => {
    const app = createTestApp();
    const request = createOtlpMetricRequest({
      serviceName: 'metrics-app',
      metricName: 'http.requests.total',
      value: 150,
      type: 'sum',
    });

    await app.request('/v1/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    const metricBuffer = getMetricBuffer();
    const stored = metricBuffer.getAll('metrics-app');
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('http.requests.total');
    expect(stored[0].value).toBe(150);
    expect(stored[0].type).toBe('Sum');
  });

  it('should store gauge metrics', async () => {
    const app = createTestApp();
    const request = createOtlpMetricRequest({
      serviceName: 'gauge-app',
      metricName: 'system.memory',
      value: 512.5,
      type: 'gauge',
      unit: 'MB',
    });

    await app.request('/v1/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    const metricBuffer = getMetricBuffer();
    const stored = metricBuffer.getAll('gauge-app');
    expect(stored).toHaveLength(1);
    expect(stored[0].type).toBe('Gauge');
    expect(stored[0].value).toBe(512.5);
    expect(stored[0].unit).toBe('MB');
  });

  it('should handle empty OTLP metrics request', async () => {
    const app = createTestApp();

    const response = await app.request('/v1/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emptyOtlpMetricRequest),
    });

    expect(response.status).toBe(200);
  });

  it('should return 400 for invalid JSON', async () => {
    const app = createTestApp();

    const response = await app.request('/v1/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid',
    });

    expect(response.status).toBe(400);
  });
});

describe('POST /v1/traces (OTLP)', () => {
  it('should accept an OTLP traces request and return 200', async () => {
    const app = createTestApp();
    const request = createOtlpTraceRequest();

    const response = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  it('should store spans in the trace buffer', async () => {
    const app = createTestApp();
    const request = createOtlpTraceRequest({
      serviceName: 'tracing-app',
      traceId: 'trace-xyz',
      spanId: 'span-123',
      name: 'POST /api/orders',
    });

    await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    const traceBuffer = getTraceBuffer();
    const stored = traceBuffer.getAll('tracing-app');
    expect(stored).toHaveLength(1);
    expect(stored[0].traceId).toBe('trace-xyz');
    expect(stored[0].spanId).toBe('span-123');
    expect(stored[0].name).toBe('POST /api/orders');
  });

  it('should store span attributes', async () => {
    const app = createTestApp();
    const request = createOtlpTraceRequest({
      serviceName: 'attr-app',
      attributes: [
        { key: 'http.method', value: { stringValue: 'POST' } },
        { key: 'http.status_code', value: { intValue: 201 } },
      ],
    });

    await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    const traceBuffer = getTraceBuffer();
    const stored = traceBuffer.getAll('attr-app');
    expect(stored[0].attributes['http.method']).toBe('POST');
    expect(stored[0].attributes['http.status_code']).toBe(201);
  });

  it('should handle empty OTLP traces request', async () => {
    const app = createTestApp();

    const response = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emptyOtlpTraceRequest),
    });

    expect(response.status).toBe(200);
  });

  it('should return 400 for invalid JSON', async () => {
    const app = createTestApp();

    const response = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid',
    });

    expect(response.status).toBe(400);
  });
});
