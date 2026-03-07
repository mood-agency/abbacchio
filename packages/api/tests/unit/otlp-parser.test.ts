import { describe, it, expect } from 'bun:test';
import { parseOtlpLogs, parseOtlpMetrics, parseOtlpTraces } from '../../src/lib/otlp-parser.js';
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

describe('parseOtlpLogs', () => {
  it('should parse a single OTLP log record', () => {
    const request = createOtlpLogRequest({ body: 'Hello world', severityNumber: 9 });
    const logs = parseOtlpLogs(request, 'default');

    expect(logs).toHaveLength(1);
    expect(logs[0].msg).toBe('Hello world');
    expect(logs[0].level).toBe(30); // INFO
  });

  it('should extract service.name as channel', () => {
    const request = createOtlpLogRequest({ serviceName: 'my-pino-app' });
    const logs = parseOtlpLogs(request, 'fallback');

    expect(logs[0].channel).toBe('my-pino-app');
  });

  it('should fall back to default channel when service.name is missing', () => {
    const request: any = {
      resourceLogs: [{
        resource: { attributes: [] },
        scopeLogs: [{
          logRecords: [{
            severityNumber: 9,
            body: { stringValue: 'no service name' },
          }],
        }],
      }],
    };
    const logs = parseOtlpLogs(request, 'my-default');

    expect(logs[0].channel).toBe('my-default');
  });

  it('should map OTLP severity numbers to Pino levels', () => {
    const testCases = [
      { severity: 1, expectedPinoLevel: 10 },   // TRACE
      { severity: 4, expectedPinoLevel: 10 },   // TRACE
      { severity: 5, expectedPinoLevel: 20 },   // DEBUG
      { severity: 8, expectedPinoLevel: 20 },   // DEBUG
      { severity: 9, expectedPinoLevel: 30 },   // INFO
      { severity: 12, expectedPinoLevel: 30 },  // INFO
      { severity: 13, expectedPinoLevel: 40 },  // WARN
      { severity: 16, expectedPinoLevel: 40 },  // WARN
      { severity: 17, expectedPinoLevel: 50 },  // ERROR
      { severity: 20, expectedPinoLevel: 50 },  // ERROR
      { severity: 21, expectedPinoLevel: 60 },  // FATAL
      { severity: 24, expectedPinoLevel: 60 },  // FATAL
    ];

    for (const { severity, expectedPinoLevel } of testCases) {
      const request = createOtlpLogRequest({ severityNumber: severity });
      const logs = parseOtlpLogs(request, 'default');
      expect(logs[0].level).toBe(expectedPinoLevel);
    }
  });

  it('should default to level 30 (info) when severity is missing', () => {
    const request: any = {
      resourceLogs: [{
        resource: { attributes: [] },
        scopeLogs: [{
          logRecords: [{
            body: { stringValue: 'no severity' },
          }],
        }],
      }],
    };
    const logs = parseOtlpLogs(request, 'default');
    expect(logs[0].level).toBe(30);
  });

  it('should convert timeUnixNano to milliseconds', () => {
    const request = createOtlpLogRequest({ timeUnixNano: '1700000000000000000' });
    const logs = parseOtlpLogs(request, 'default');

    expect(logs[0].time).toBe(1700000000000);
  });

  it('should parse log record attributes', () => {
    const request = createOtlpLogRequest({
      attributes: [
        { key: 'userId', value: { intValue: 42 } },
        { key: 'action', value: { stringValue: 'login' } },
        { key: 'success', value: { boolValue: true } },
        { key: 'latency', value: { doubleValue: 1.5 } },
      ],
    });
    const logs = parseOtlpLogs(request, 'default');

    expect(logs[0].userId).toBe(42);
    expect(logs[0].action).toBe('login');
    expect(logs[0].success).toBe(true);
    expect(logs[0].latency).toBe(1.5);
  });

  it('should include traceId and spanId for correlation', () => {
    const request = createOtlpLogRequest({
      traceId: 'trace-abc-123',
      spanId: 'span-def-456',
    });
    const logs = parseOtlpLogs(request, 'default');

    expect(logs[0].traceId).toBe('trace-abc-123');
    expect(logs[0].spanId).toBe('span-def-456');
  });

  it('should parse multiple log records in a batch', () => {
    const request = createOtlpLogBatch(5, 'batch-app');
    const logs = parseOtlpLogs(request, 'default');

    expect(logs).toHaveLength(5);
    expect(logs[0].msg).toBe('Batch log 1');
    expect(logs[4].msg).toBe('Batch log 5');
    expect(logs.every(l => l.channel === 'batch-app')).toBe(true);
  });

  it('should return empty array for empty resourceLogs', () => {
    const logs = parseOtlpLogs(emptyOtlpLogRequest, 'default');
    expect(logs).toHaveLength(0);
  });

  it('should return empty array for missing resourceLogs', () => {
    const logs = parseOtlpLogs({} as any, 'default');
    expect(logs).toHaveLength(0);
  });

  it('should handle pino-opentelemetry-transport style log', () => {
    const request = createPinoOtelLogRequest({
      msg: 'User logged in',
      level: 'info',
      serviceName: 'pino-otel-test',
      attributes: { userId: 42, action: 'login' },
    });
    const logs = parseOtlpLogs(request, 'default');

    expect(logs).toHaveLength(1);
    expect(logs[0].msg).toBe('User logged in');
    expect(logs[0].level).toBe(30);
    expect(logs[0].channel).toBe('pino-otel-test');
    expect(logs[0].userId).toBe(42);
    expect(logs[0].action).toBe('login');
  });

  it('should handle pino-opentelemetry-transport warn level', () => {
    const request = createPinoOtelLogRequest({
      msg: 'Slow response',
      level: 'warn',
      attributes: { latency: 1500 },
    });
    const logs = parseOtlpLogs(request, 'default');

    expect(logs[0].level).toBe(40);
    expect(logs[0].latency).toBe(1500);
  });

  it('should handle pino-opentelemetry-transport error level', () => {
    const request = createPinoOtelLogRequest({
      msg: 'Connection timeout',
      level: 'error',
      attributes: { code: 'ERR_TIMEOUT' },
    });
    const logs = parseOtlpLogs(request, 'default');

    expect(logs[0].level).toBe(50);
    expect(logs[0].code).toBe('ERR_TIMEOUT');
  });

  it('should handle multiple resource logs (multiple services)', () => {
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
    const logs = parseOtlpLogs(request, 'default');

    expect(logs).toHaveLength(2);
    expect(logs[0].channel).toBe('service-a');
    expect(logs[0].msg).toBe('from A');
    expect(logs[1].channel).toBe('service-b');
    expect(logs[1].msg).toBe('from B');
    expect(logs[1].level).toBe(40);
  });
});

describe('parseOtlpMetrics', () => {
  it('should parse a Sum metric', () => {
    const request = createOtlpMetricRequest({
      metricName: 'http.requests',
      type: 'sum',
      value: 100,
    });
    const metrics = parseOtlpMetrics(request, 'default');

    expect(metrics).toHaveLength(1);
    expect(metrics[0].name).toBe('http.requests');
    expect(metrics[0].type).toBe('Sum');
    expect(metrics[0].value).toBe(100);
  });

  it('should parse a Gauge metric', () => {
    const request = createOtlpMetricRequest({
      metricName: 'system.memory.usage',
      type: 'gauge',
      value: 512.5,
      unit: 'MB',
    });
    const metrics = parseOtlpMetrics(request, 'default');

    expect(metrics).toHaveLength(1);
    expect(metrics[0].name).toBe('system.memory.usage');
    expect(metrics[0].type).toBe('Gauge');
    expect(metrics[0].value).toBe(512.5);
    expect(metrics[0].unit).toBe('MB');
  });

  it('should extract service.name as channel', () => {
    const request = createOtlpMetricRequest({ serviceName: 'metrics-app' });
    const metrics = parseOtlpMetrics(request, 'fallback');

    expect(metrics[0].channel).toBe('metrics-app');
  });

  it('should return empty array for empty resourceMetrics', () => {
    const metrics = parseOtlpMetrics(emptyOtlpMetricRequest, 'default');
    expect(metrics).toHaveLength(0);
  });

  it('should return empty array for missing resourceMetrics', () => {
    const metrics = parseOtlpMetrics({} as any, 'default');
    expect(metrics).toHaveLength(0);
  });

  it('should parse metric attributes', () => {
    const request = createOtlpMetricRequest({
      attributes: [
        { key: 'http.method', value: { stringValue: 'GET' } },
        { key: 'http.status_code', value: { intValue: 200 } },
      ],
    });
    const metrics = parseOtlpMetrics(request, 'default');

    expect(metrics[0].attributes['http.method']).toBe('GET');
    expect(metrics[0].attributes['http.status_code']).toBe(200);
  });
});

describe('parseOtlpTraces', () => {
  it('should parse a single span', () => {
    const request = createOtlpTraceRequest({
      traceId: 'trace-123',
      spanId: 'span-456',
      name: 'GET /api/users',
    });
    const spans = parseOtlpTraces(request, 'default');

    expect(spans).toHaveLength(1);
    expect(spans[0].traceId).toBe('trace-123');
    expect(spans[0].spanId).toBe('span-456');
    expect(spans[0].name).toBe('GET /api/users');
  });

  it('should extract service.name as channel', () => {
    const request = createOtlpTraceRequest({ serviceName: 'tracing-app' });
    const spans = parseOtlpTraces(request, 'fallback');

    expect(spans[0].channel).toBe('tracing-app');
  });

  it('should parse span attributes', () => {
    const request = createOtlpTraceRequest({
      attributes: [
        { key: 'http.method', value: { stringValue: 'POST' } },
        { key: 'http.status_code', value: { intValue: 201 } },
      ],
    });
    const spans = parseOtlpTraces(request, 'default');

    expect(spans[0].attributes['http.method']).toBe('POST');
    expect(spans[0].attributes['http.status_code']).toBe(201);
  });

  it('should parse parent span ID', () => {
    const request = createOtlpTraceRequest({
      parentSpanId: 'parent-span-789',
    });
    const spans = parseOtlpTraces(request, 'default');

    expect(spans[0].parentSpanId).toBe('parent-span-789');
  });

  it('should parse span status', () => {
    const request = createOtlpTraceRequest({ statusCode: 2 });
    const spans = parseOtlpTraces(request, 'default');

    expect(spans[0].status?.code).toBe(2);
  });

  it('should convert nanosecond time fields to milliseconds', () => {
    const request = createOtlpTraceRequest({
      startTimeUnixNano: '1700000000000000000',
      endTimeUnixNano: '1700000000100000000',
    });
    const spans = parseOtlpTraces(request, 'default');

    // 1700000000000000000 ns = 1700000000000 ms
    expect(spans[0].startTimeMs).toBe(1700000000000);
    // 1700000000100000000 ns = 1700000000100 ms
    expect(spans[0].endTimeMs).toBe(1700000000100);
  });

  it('should return empty array for empty resourceSpans', () => {
    const spans = parseOtlpTraces(emptyOtlpTraceRequest, 'default');
    expect(spans).toHaveLength(0);
  });

  it('should return empty array for missing resourceSpans', () => {
    const spans = parseOtlpTraces({} as any, 'default');
    expect(spans).toHaveLength(0);
  });
});
