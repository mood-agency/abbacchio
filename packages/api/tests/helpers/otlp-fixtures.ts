import type { OTLPExportLogsServiceRequest, OTLPExportMetricsServiceRequest, OTLPExportTraceServiceRequest } from '../../src/lib/otlp-parser.js';

/**
 * Creates an OTLP log export request matching what pino-opentelemetry-transport sends.
 */
export function createOtlpLogRequest(overrides: {
  serviceName?: string;
  severityNumber?: number;
  body?: string;
  traceId?: string;
  spanId?: string;
  attributes?: Array<{ key: string; value: Record<string, unknown> }>;
  timeUnixNano?: string;
} = {}): OTLPExportLogsServiceRequest {
  return {
    resourceLogs: [{
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: overrides.serviceName || 'test-service' } },
          { key: 'telemetry.sdk.name', value: { stringValue: 'opentelemetry' } },
          { key: 'telemetry.sdk.language', value: { stringValue: 'nodejs' } },
        ],
      },
      scopeLogs: [{
        logRecords: [{
          timeUnixNano: overrides.timeUnixNano || '1700000000000000000',
          severityNumber: overrides.severityNumber ?? 9,
          body: { stringValue: overrides.body || 'Test log message' },
          traceId: overrides.traceId || '',
          spanId: overrides.spanId || '',
          attributes: overrides.attributes || [],
        }],
      }],
    }],
  };
}

/**
 * Creates a batch OTLP log request with multiple log records.
 */
export function createOtlpLogBatch(count: number, serviceName = 'batch-service'): OTLPExportLogsServiceRequest {
  const logRecords = Array.from({ length: count }, (_, i) => ({
    timeUnixNano: String(1700000000000000000n + BigInt(i * 1000000)),
    severityNumber: 9, // INFO
    body: { stringValue: `Batch log ${i + 1}` },
    traceId: '',
    spanId: '',
    attributes: [
      { key: 'index', value: { intValue: i } },
    ],
  }));

  return {
    resourceLogs: [{
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: serviceName } },
        ],
      },
      scopeLogs: [{ logRecords }],
    }],
  };
}

/**
 * Creates an OTLP log request mimicking pino-opentelemetry-transport output.
 * Pino attributes like userId, action etc. are sent as OTLP log record attributes.
 */
export function createPinoOtelLogRequest(pinoLog: {
  msg: string;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  serviceName?: string;
  attributes?: Record<string, string | number | boolean>;
}): OTLPExportLogsServiceRequest {
  const severityMap = { trace: 1, debug: 5, info: 9, warn: 13, error: 17, fatal: 21 };
  const severity = severityMap[pinoLog.level];

  const otlpAttributes = pinoLog.attributes
    ? Object.entries(pinoLog.attributes).map(([key, val]) => ({
        key,
        value: typeof val === 'string'
          ? { stringValue: val }
          : typeof val === 'number'
            ? (Number.isInteger(val) ? { intValue: val } : { doubleValue: val })
            : { boolValue: val },
      }))
    : [];

  return createOtlpLogRequest({
    serviceName: pinoLog.serviceName || 'pino-app',
    severityNumber: severity,
    body: pinoLog.msg,
    attributes: otlpAttributes,
  });
}

/**
 * Creates an OTLP metrics export request.
 */
export function createOtlpMetricRequest(overrides: {
  serviceName?: string;
  metricName?: string;
  description?: string;
  unit?: string;
  type?: 'sum' | 'gauge';
  value?: number;
  timeUnixNano?: string;
  attributes?: Array<{ key: string; value: Record<string, unknown> }>;
} = {}): OTLPExportMetricsServiceRequest {
  const dp = {
    timeUnixNano: overrides.timeUnixNano || '1700000000000000000',
    asDouble: overrides.value ?? 42,
    attributes: overrides.attributes || [],
  };

  const metricType = overrides.type || 'sum';
  const metric: Record<string, unknown> = {
    name: overrides.metricName || 'http.requests',
    description: overrides.description || 'Total HTTP requests',
    unit: overrides.unit || '1',
  };

  if (metricType === 'sum') {
    metric.sum = { dataPoints: [dp], isMonotonic: true };
  } else {
    metric.gauge = { dataPoints: [dp] };
  }

  return {
    resourceMetrics: [{
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: overrides.serviceName || 'test-service' } },
        ],
      },
      scopeMetrics: [{ metrics: [metric as any] }],
    }],
  };
}

/**
 * Creates an OTLP trace export request.
 */
export function createOtlpTraceRequest(overrides: {
  serviceName?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  statusCode?: number;
  attributes?: Array<{ key: string; value: Record<string, unknown> }>;
} = {}): OTLPExportTraceServiceRequest {
  return {
    resourceSpans: [{
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: overrides.serviceName || 'test-service' } },
        ],
      },
      scopeSpans: [{
        spans: [{
          traceId: overrides.traceId || 'abc123def456',
          spanId: overrides.spanId || 'span001',
          parentSpanId: overrides.parentSpanId,
          name: overrides.name || 'GET /api/users',
          startTimeUnixNano: overrides.startTimeUnixNano || '1700000000000000000',
          endTimeUnixNano: overrides.endTimeUnixNano || '1700000000050000000',
          attributes: overrides.attributes || [
            { key: 'http.method', value: { stringValue: 'GET' } },
            { key: 'http.status_code', value: { intValue: 200 } },
          ],
          status: overrides.statusCode !== undefined
            ? { code: overrides.statusCode }
            : { code: 1 },
        }],
      }],
    }],
  };
}

/**
 * Empty OTLP requests for edge case testing.
 */
export const emptyOtlpLogRequest: OTLPExportLogsServiceRequest = { resourceLogs: [] };
export const emptyOtlpMetricRequest: OTLPExportMetricsServiceRequest = { resourceMetrics: [] };
export const emptyOtlpTraceRequest: OTLPExportTraceServiceRequest = { resourceSpans: [] };
