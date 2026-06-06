import type { IncomingLog, MetricDataPoint, TraceSpan } from '../types.js';

// --- OTLP JSON Types ---
// Simplified types based on OTLP HTTP JSON specs
// https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding

export interface OTLPResource {
    attributes?: OTLPKeyValue[];
}

export interface OTLPKeyValue {
    key: string;
    value: {
        stringValue?: string;
        intValue?: number | string;
        doubleValue?: number;
        boolValue?: boolean;
    };
}

export interface OTLPExportLogsServiceRequest {
    resourceLogs?: {
        resource?: OTLPResource;
        scopeLogs?: {
            logRecords?: any[];
        }[];
    }[];
}

export interface OTLPExportMetricsServiceRequest {
    resourceMetrics?: {
        resource?: OTLPResource;
        scopeMetrics?: {
            metrics?: any[];
        }[];
    }[];
}

export interface OTLPExportTraceServiceRequest {
    resourceSpans?: {
        resource?: OTLPResource;
        scopeSpans?: {
            spans?: any[];
        }[];
    }[];
}

/**
 * Extract channel from OTLP Resource attributes (service.name)
 * Fallbacks to a default if not found.
 */
function getChannelFromResource(resource: OTLPResource | undefined, defaultChannel: string): string {
    if (!resource || !Array.isArray(resource.attributes)) {
        return defaultChannel;
    }

    const serviceNameAttr = resource.attributes.find((attr) => attr.key === 'service.name');
    if (serviceNameAttr && serviceNameAttr.value && serviceNameAttr.value.stringValue) {
        return serviceNameAttr.value.stringValue;
    }

    return defaultChannel;
}

/**
 * Extract emitter identity from OTLP Resource attributes.
 * Uses the standard `service.instance.id` resource attribute for instanceId.
 * These are fallbacks; request headers (X-Source/X-Instance-Id) take precedence
 * and are applied later by the handler via stampIdentity().
 */
function getIdentityFromResource(resource: OTLPResource | undefined): { source?: string; instanceId?: string } {
    if (!resource || !Array.isArray(resource.attributes)) return {};
    let source: string | undefined;
    let instanceId: string | undefined;
    for (const attr of resource.attributes) {
        const val = attr.value?.stringValue;
        if (!val) continue;
        if (attr.key === 'service.instance.id') instanceId = val;
        else if (attr.key === 'service.source') source = val;
    }
    return { source, instanceId };
}

/**
 * Convert OTLP KeyValue array to a simple Record map
 */
function parseAttributes(attributes?: OTLPKeyValue[]): Record<string, string | number | boolean> {
    const result: Record<string, string | number | boolean> = {};
    if (!Array.isArray(attributes)) return result;

    for (const attr of attributes) {
        const val = attr.value;
        if (!val) continue;

        if (val.stringValue !== undefined) result[attr.key] = val.stringValue;
        else if (val.intValue !== undefined) result[attr.key] = Number(val.intValue);
        else if (val.doubleValue !== undefined) result[attr.key] = val.doubleValue;
        else if (val.boolValue !== undefined) result[attr.key] = val.boolValue;
    }
    return result;
}

/**
 * Maps OTLP severity number to Pino level number
 */
function severityNumberToPinoLevel(severityNumber?: number): number {
    if (!severityNumber) return 30; // Default info
    // OTel SeverityNumber:
    // 1-4: TRACE -> Pino 10
    // 5-8: DEBUG -> Pino 20
    // 9-12: INFO -> Pino 30
    // 13-16: WARN -> Pino 40
    // 17-20: ERROR -> Pino 50
    // 21-24: FATAL -> Pino 60
    if (severityNumber <= 4) return 10;
    if (severityNumber <= 8) return 20;
    if (severityNumber <= 12) return 30;
    if (severityNumber <= 16) return 40;
    if (severityNumber <= 20) return 50;
    return 60;
}

/**
 * Parse OTLP JSON logs request into Abbacchio IncomingLog[]
 */
export function parseOtlpLogs(request: OTLPExportLogsServiceRequest, defaultChannel: string): IncomingLog[] {
    const incomingLogs: IncomingLog[] = [];

    if (!Array.isArray(request.resourceLogs)) return incomingLogs;

    for (const resourceLog of request.resourceLogs) {
        const channel = getChannelFromResource(resourceLog.resource, defaultChannel);
        const identity = getIdentityFromResource(resourceLog.resource);

        if (!Array.isArray(resourceLog.scopeLogs)) continue;

        for (const scopeLog of resourceLog.scopeLogs) {
            if (!Array.isArray(scopeLog.logRecords)) continue;

            for (const logRecord of scopeLog.logRecords) {
                const timeUnixNano = logRecord.timeUnixNano || logRecord.observedTimeUnixNano;
                const time = timeUnixNano ? Math.floor(Number(timeUnixNano) / 1_000_000) : Date.now();

                const attributes = parseAttributes(logRecord.attributes);
                const msg = logRecord.body?.stringValue || '';

                const incoming: IncomingLog = {
                    time,
                    level: severityNumberToPinoLevel(logRecord.severityNumber),
                    msg,
                    channel: channel,
                    traceId: logRecord.traceId,
                    spanId: logRecord.spanId,
                    source: identity.source,
                    instanceId: identity.instanceId,
                    ...attributes, // Dump attributes at root
                };

                incomingLogs.push(incoming);
            }
        }
    }

    return incomingLogs;
}

/**
 * Parse OTLP JSON metrics request into Abbacchio MetricDataPoint[]
 */
export function parseOtlpMetrics(request: OTLPExportMetricsServiceRequest, defaultChannel: string): MetricDataPoint[] {
    const dataPoints: MetricDataPoint[] = [];

    if (!Array.isArray(request.resourceMetrics)) return dataPoints;

    for (const resourceMetric of request.resourceMetrics) {
        const channel = getChannelFromResource(resourceMetric.resource, defaultChannel);

        if (!Array.isArray(resourceMetric.scopeMetrics)) continue;

        for (const scopeMetric of resourceMetric.scopeMetrics) {
            if (!Array.isArray(scopeMetric.metrics)) continue;

            for (const metric of scopeMetric.metrics) {
                const name = metric.name;
                const description = metric.description;
                const unit = metric.unit;

                // Sum (Counter)
                if (metric.sum && Array.isArray(metric.sum.dataPoints)) {
                    for (const dp of metric.sum.dataPoints) {
                        dataPoints.push({
                            name,
                            description,
                            unit,
                            type: 'Sum',
                            channel,
                            timeUnixNano: Number(dp.timeUnixNano),
                            value: dp.asDouble !== undefined ? dp.asDouble : Number(dp.asInt || 0),
                            attributes: parseAttributes(dp.attributes),
                        });
                    }
                }

                // Gauge
                if (metric.gauge && Array.isArray(metric.gauge.dataPoints)) {
                    for (const dp of metric.gauge.dataPoints) {
                        dataPoints.push({
                            name,
                            description,
                            unit,
                            type: 'Gauge',
                            channel,
                            timeUnixNano: Number(dp.timeUnixNano),
                            value: dp.asDouble !== undefined ? dp.asDouble : Number(dp.asInt || 0),
                            attributes: parseAttributes(dp.attributes),
                        });
                    }
                }

                // Histogram
                if (metric.histogram && Array.isArray(metric.histogram.dataPoints)) {
                    for (const dp of metric.histogram.dataPoints) {
                        dataPoints.push({
                            name,
                            description,
                            unit,
                            type: 'Histogram',
                            channel,
                            timeUnixNano: Number(dp.timeUnixNano),
                            value: dp.sum !== undefined ? dp.sum : 0,
                            count: dp.count !== undefined ? Number(dp.count) : 0,
                            bucketCounts: Array.isArray(dp.bucketCounts) ? dp.bucketCounts.map(Number) : undefined,
                            explicitBounds: Array.isArray(dp.explicitBounds) ? dp.explicitBounds.map(Number) : undefined,
                            attributes: parseAttributes(dp.attributes),
                        });
                    }
                }
            }
        }
    }

    return dataPoints;
}

/**
 * Parse OTLP JSON trace request into Abbacchio TraceSpan[]
 */
export function parseOtlpTraces(request: OTLPExportTraceServiceRequest, defaultChannel: string): TraceSpan[] {
    const spans: TraceSpan[] = [];

    if (!Array.isArray(request.resourceSpans)) return spans;

    for (const resourceSpan of request.resourceSpans) {
        const channel = getChannelFromResource(resourceSpan.resource, defaultChannel);

        if (!Array.isArray(resourceSpan.scopeSpans)) continue;

        for (const scopeSpan of resourceSpan.scopeSpans) {
            if (!Array.isArray(scopeSpan.spans)) continue;

            for (const span of scopeSpan.spans) {
                // OTLP nanosecond timestamps can be 19+ digits, exceeding JS Number.MAX_SAFE_INTEGER.
                // Convert to milliseconds using BigInt for precision.
                const startNano = BigInt(span.startTimeUnixNano || '0');
                const endNano = BigInt(span.endTimeUnixNano || '0');
                spans.push({
                    traceId: span.traceId,
                    spanId: span.spanId,
                    parentSpanId: span.parentSpanId,
                    name: span.name,
                    startTimeMs: Number(startNano / 1_000_000n),
                    endTimeMs: Number(endNano / 1_000_000n),
                    channel,
                    attributes: parseAttributes(span.attributes),
                    status: span.status ? {
                        code: span.status.code,
                        message: span.status.message,
                    } : undefined
                });
            }
        }
    }

    return spans;
}
