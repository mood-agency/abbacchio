import os from "node:os";

/** Best-effort default emitter identity for a Node/Bun process. */
function defaultIdentity(): { source: string | undefined; instanceId: string | undefined } {
  try {
    const hostname = os.hostname();
    const pid = typeof process !== "undefined" ? process.pid : undefined;
    return {
      source: hostname || undefined,
      instanceId: hostname && pid !== undefined ? `${hostname}:${pid}` : hostname || undefined,
    };
  } catch {
    return { source: undefined, instanceId: undefined };
  }
}

/**
 * OTLP severity numbers per OpenTelemetry spec.
 * https://opentelemetry.io/docs/specs/otel/logs/data-model/#severity-fields
 */
const PINO_TO_OTLP_SEVERITY: Record<number, { number: number; text: string }> = {
  10: { number: 1, text: 'TRACE' },
  20: { number: 5, text: 'DEBUG' },
  30: { number: 9, text: 'INFO' },
  40: { number: 13, text: 'WARN' },
  50: { number: 17, text: 'ERROR' },
  60: { number: 21, text: 'FATAL' },
};

/**
 * Convert a flat Record to OTLP KeyValue[] attributes.
 */
function toOtlpAttributes(obj: Record<string, unknown>): OtlpKeyValue[] {
  const attrs: OtlpKeyValue[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    attrs.push({ key, value: toOtlpAnyValue(val) });
  }
  return attrs;
}

function toOtlpAnyValue(val: unknown): OtlpAnyValue {
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { intValue: val } : { doubleValue: val };
  }
  if (typeof val === 'boolean') return { boolValue: val };
  return { stringValue: String(val) };
}

interface OtlpAnyValue {
  stringValue?: string;
  intValue?: number;
  doubleValue?: number;
  boolValue?: boolean;
}

interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

export interface AbbacchioClientOptions {
  /** Base URL of the OTLP server (e.g. "http://localhost:4002"). Logs go to {endpoint}/v1/logs */
  endpoint?: string;
  /** @deprecated Use `endpoint` instead. If set, used as the full URL for log ingestion. */
  url?: string;
  /** Service name — maps to OTLP resource attribute `service.name`. Defaults to 'default' */
  serviceName?: string;
  /**
   * Self-declared emitter label sent on every request via the `X-Source` header.
   * Defaults to the OS hostname. Note: identity is NOT cryptographically verified.
   */
  source?: string;
  /**
   * Self-declared unique instance id sent via the `X-Instance-Id` header.
   * Defaults to `<hostname>:<pid>`.
   */
  instanceId?: string;
  /** Additional OTLP resource attributes */
  resourceAttributes?: Record<string, string>;
  /** Number of log records to batch before sending. Defaults to 10 */
  batchSize?: number;
  /** Interval in ms between flushes. Defaults to 1000 */
  interval?: number;
  /** Additional headers to send with requests */
  headers?: Record<string, string>;
  /** Whether to send data to the server. Defaults to true */
  enabled?: boolean;
}

/**
 * A log entry in the format the transports produce before OTLP conversion.
 */
export interface LogRecord {
  level?: number;
  msg?: string;
  message?: string;
  time?: number;
  [key: string]: unknown;
}

/**
 * A metric data point to send via OTLP.
 */
export interface MetricRecord {
  name: string;
  description?: string;
  unit?: string;
  type: 'sum' | 'gauge';
  value: number;
  attributes?: Record<string, unknown>;
  isMonotonic?: boolean;
}

/**
 * A histogram data point to send via OTLP.
 *
 * Each record is a single observation. The client accumulates observations
 * into OTLP Histogram data points (with explicit bucket boundaries) on flush.
 */
export interface HistogramRecord {
  name: string;
  description?: string;
  unit?: string;
  /** The observed value (e.g. request duration in ms) */
  value: number;
  attributes?: Record<string, unknown>;
  /**
   * Explicit bucket boundaries. Defaults to a standard latency distribution:
   * [5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 10000]
   */
  explicitBounds?: number[];
}

/**
 * A trace span to send via OTLP.
 */
export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: Record<string, unknown>;
  status?: { code: number; message?: string };
}

/**
 * OTLP-native HTTP client for Abbacchio.
 * Sends logs to POST /v1/logs, metrics to POST /v1/metrics, traces to POST /v1/traces.
 */
export class AbbacchioClient {
  private endpoint: string;
  private serviceName: string;
  private source?: string;
  private instanceId?: string;
  private resourceAttributes: Record<string, string>;
  private batchSize: number;
  private interval: number;
  private headers: Record<string, string>;
  private enabled: boolean;

  private logBuffer: LogRecord[] = [];
  private metricBuffer: MetricRecord[] = [];
  private histogramBuffer: HistogramRecord[] = [];
  private spanBuffer: SpanRecord[] = [];
  private logTimer: ReturnType<typeof setTimeout> | null = null;
  private metricTimer: ReturnType<typeof setTimeout> | null = null;
  private histogramTimer: ReturnType<typeof setTimeout> | null = null;
  private spanTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: AbbacchioClientOptions = {}) {
    // Support legacy `url` option: if it looks like a full URL with path, strip the path
    if (options.url && !options.endpoint) {
      try {
        const u = new URL(options.url);
        this.endpoint = `${u.protocol}//${u.host}`;
      } catch {
        this.endpoint = options.url;
      }
    } else {
      this.endpoint = options.endpoint || 'http://localhost:4002';
    }
    this.serviceName = options.serviceName || 'default';
    const fallback = defaultIdentity();
    this.source = options.source ?? fallback.source;
    this.instanceId = options.instanceId ?? fallback.instanceId;
    this.resourceAttributes = options.resourceAttributes || {};
    this.batchSize = options.batchSize || 10;
    this.interval = options.interval || 1000;
    this.headers = options.headers || {};
    this.enabled = options.enabled ?? true;
  }

  /** Change the service name dynamically */
  setServiceName(name: string): void {
    this.serviceName = name;
  }

  /** Get the current service name */
  getServiceName(): string {
    return this.serviceName;
  }

  /** Enable sending data to the server */
  enable(): void {
    this.enabled = true;
  }

  /** Disable sending data to the server. Data will be silently dropped. */
  disable(): void {
    this.enabled = false;
  }

  /** Check if the client is currently enabled */
  isEnabled(): boolean {
    return this.enabled;
  }

  // ─── Logs ──────────────────────────────────────────

  /** Add a log record to the buffer */
  add(log: LogRecord | unknown): void {
    if (!this.enabled) return;
    this.logBuffer.push(log as LogRecord);

    if (this.logBuffer.length >= this.batchSize) {
      this.flushLogs();
    } else {
      this.scheduleLogFlush();
    }
  }

  /** Add multiple log records at once */
  addBatch(logs: (LogRecord | unknown)[]): void {
    if (!this.enabled) return;
    for (const log of logs) {
      this.logBuffer.push(log as LogRecord);
    }
    if (this.logBuffer.length >= this.batchSize) {
      this.flushLogs();
    } else {
      this.scheduleLogFlush();
    }
  }

  /** Send logs immediately without batching */
  async send(logs: (LogRecord | unknown)[]): Promise<void> {
    if (!this.enabled) return;
    await this.sendLogs(logs as LogRecord[]);
  }

  private scheduleLogFlush(): void {
    if (this.logTimer) return;
    this.logTimer = setTimeout(() => {
      this.logTimer = null;
      this.flushLogs();
    }, this.interval);
  }

  async flushLogs(): Promise<void> {
    if (this.logBuffer.length === 0) return;
    const batch = this.logBuffer;
    this.logBuffer = [];
    await this.sendLogs(batch);
  }

  private async sendLogs(logs: LogRecord[]): Promise<void> {
    const logRecords = logs.map((log) => {
      const { level, msg, message, time, ...extra } = log;
      const pinoLevel = typeof level === 'number' ? level : 30;
      const severity = PINO_TO_OTLP_SEVERITY[pinoLevel] || PINO_TO_OTLP_SEVERITY[30];
      const body = msg || message || '';
      const timeNano = String((time || Date.now()) * 1_000_000);

      return {
        timeUnixNano: timeNano,
        observedTimeUnixNano: timeNano,
        severityNumber: severity.number,
        severityText: severity.text,
        body: { stringValue: String(body) },
        attributes: toOtlpAttributes(extra as Record<string, unknown>),
      };
    });

    const payload = {
      resourceLogs: [{
        resource: { attributes: this.buildResourceAttributes() },
        scopeLogs: [{
          scope: { name: '@abbacchio/transport' },
          logRecords,
        }],
      }],
    };

    await this.post('/v1/logs', payload);
  }

  // ─── Metrics ───────────────────────────────────────

  /** Add a metric data point to the buffer */
  addMetric(metric: MetricRecord): void {
    if (!this.enabled) return;
    this.metricBuffer.push(metric);

    if (this.metricBuffer.length >= this.batchSize) {
      this.flushMetrics();
    } else {
      this.scheduleMetricFlush();
    }
  }

  private scheduleMetricFlush(): void {
    if (this.metricTimer) return;
    this.metricTimer = setTimeout(() => {
      this.metricTimer = null;
      this.flushMetrics();
    }, this.interval);
  }

  async flushMetrics(): Promise<void> {
    if (this.metricBuffer.length === 0) return;
    const batch = this.metricBuffer;
    this.metricBuffer = [];
    await this.sendMetrics(batch);
  }

  private async sendMetrics(metrics: MetricRecord[]): Promise<void> {
    // Group by metric name to build proper OTLP structure
    const byName = new Map<string, MetricRecord[]>();
    for (const m of metrics) {
      const arr = byName.get(m.name) || [];
      arr.push(m);
      byName.set(m.name, arr);
    }

    const otlpMetrics: unknown[] = [];
    for (const [name, records] of byName) {
      const first = records[0];
      const dataPoints = records.map((r) => ({
        timeUnixNano: String(Date.now() * 1_000_000),
        asDouble: r.value,
        attributes: r.attributes ? toOtlpAttributes(r.attributes) : [],
      }));

      const metric: Record<string, unknown> = {
        name,
        description: first.description || '',
        unit: first.unit || '',
      };

      if (first.type === 'sum') {
        metric.sum = {
          dataPoints,
          aggregationTemporality: 2, // CUMULATIVE
          isMonotonic: first.isMonotonic ?? true,
        };
      } else {
        metric.gauge = { dataPoints };
      }

      otlpMetrics.push(metric);
    }

    const payload = {
      resourceMetrics: [{
        resource: { attributes: this.buildResourceAttributes() },
        scopeMetrics: [{
          scope: { name: '@abbacchio/transport' },
          metrics: otlpMetrics,
        }],
      }],
    };

    await this.post('/v1/metrics', payload);
  }

  // ─── Histograms ─────────────────────────────────────

  private static DEFAULT_BOUNDS = [5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 10000];

  /** Add a histogram observation to the buffer */
  addHistogram(record: HistogramRecord): void {
    if (!this.enabled) return;
    this.histogramBuffer.push(record);

    if (this.histogramBuffer.length >= this.batchSize) {
      this.flushHistograms();
    } else {
      this.scheduleHistogramFlush();
    }
  }

  private scheduleHistogramFlush(): void {
    if (this.histogramTimer) return;
    this.histogramTimer = setTimeout(() => {
      this.histogramTimer = null;
      this.flushHistograms();
    }, this.interval);
  }

  async flushHistograms(): Promise<void> {
    if (this.histogramBuffer.length === 0) return;
    const batch = this.histogramBuffer;
    this.histogramBuffer = [];
    await this.sendHistograms(batch);
  }

  private async sendHistograms(records: HistogramRecord[]): Promise<void> {
    // Group by name+attributes key to aggregate observations into OTLP histogram data points
    const groups = new Map<string, { records: HistogramRecord[]; bounds: number[] }>();
    for (const r of records) {
      const key = JSON.stringify({ name: r.name, attributes: r.attributes });
      let group = groups.get(key);
      if (!group) {
        group = { records: [], bounds: r.explicitBounds || AbbacchioClient.DEFAULT_BOUNDS };
        groups.set(key, group);
      }
      group.records.push(r);
    }

    const otlpMetrics: unknown[] = [];
    for (const [, group] of groups) {
      const first = group.records[0];
      const bounds = group.bounds;
      const bucketCounts = new Array(bounds.length + 1).fill(0);
      let sum = 0;
      let min = Infinity;
      let max = -Infinity;

      for (const r of group.records) {
        sum += r.value;
        if (r.value < min) min = r.value;
        if (r.value > max) max = r.value;

        // Find the bucket
        let placed = false;
        for (let i = 0; i < bounds.length; i++) {
          if (r.value <= bounds[i]) {
            bucketCounts[i]++;
            placed = true;
            break;
          }
        }
        if (!placed) bucketCounts[bounds.length]++;
      }

      otlpMetrics.push({
        name: first.name,
        description: first.description || '',
        unit: first.unit || '',
        histogram: {
          dataPoints: [{
            timeUnixNano: String(Date.now() * 1_000_000),
            count: group.records.length,
            sum,
            min: min === Infinity ? 0 : min,
            max: max === -Infinity ? 0 : max,
            bucketCounts: bucketCounts.map(String),
            explicitBounds: bounds,
            attributes: first.attributes ? toOtlpAttributes(first.attributes) : [],
          }],
          aggregationTemporality: 1, // DELTA
        },
      });
    }

    const payload = {
      resourceMetrics: [{
        resource: { attributes: this.buildResourceAttributes() },
        scopeMetrics: [{
          scope: { name: '@abbacchio/transport' },
          metrics: otlpMetrics,
        }],
      }],
    };

    await this.post('/v1/metrics', payload);
  }

  // ─── Traces ────────────────────────────────────────

  /** Add a trace span to the buffer */
  addSpan(span: SpanRecord): void {
    if (!this.enabled) return;
    this.spanBuffer.push(span);

    if (this.spanBuffer.length >= this.batchSize) {
      this.flushSpans();
    } else {
      this.scheduleSpanFlush();
    }
  }

  private scheduleSpanFlush(): void {
    if (this.spanTimer) return;
    this.spanTimer = setTimeout(() => {
      this.spanTimer = null;
      this.flushSpans();
    }, this.interval);
  }

  async flushSpans(): Promise<void> {
    if (this.spanBuffer.length === 0) return;
    const batch = this.spanBuffer;
    this.spanBuffer = [];
    await this.sendSpans(batch);
  }

  private async sendSpans(spans: SpanRecord[]): Promise<void> {
    const otlpSpans = spans.map((s) => ({
      traceId: s.traceId,
      spanId: s.spanId,
      parentSpanId: s.parentSpanId,
      name: s.name,
      kind: s.kind ?? 1, // SPAN_KIND_INTERNAL
      startTimeUnixNano: s.startTimeUnixNano,
      endTimeUnixNano: s.endTimeUnixNano,
      attributes: s.attributes ? toOtlpAttributes(s.attributes) : [],
      status: s.status,
    }));

    const payload = {
      resourceSpans: [{
        resource: { attributes: this.buildResourceAttributes() },
        scopeSpans: [{
          scope: { name: '@abbacchio/transport' },
          spans: otlpSpans,
        }],
      }],
    };

    await this.post('/v1/traces', payload);
  }

  // ─── Shared ────────────────────────────────────────

  /** Flush all buffers and close the client */
  async flush(): Promise<void> {
    await Promise.all([
      this.flushLogs(),
      this.flushMetrics(),
      this.flushHistograms(),
      this.flushSpans(),
    ]);
  }

  /** Close the client and flush any remaining data */
  async close(): Promise<void> {
    if (this.logTimer) { clearTimeout(this.logTimer); this.logTimer = null; }
    if (this.metricTimer) { clearTimeout(this.metricTimer); this.metricTimer = null; }
    if (this.histogramTimer) { clearTimeout(this.histogramTimer); this.histogramTimer = null; }
    if (this.spanTimer) { clearTimeout(this.spanTimer); this.spanTimer = null; }
    await this.flush();
  }

  private buildResourceAttributes(): OtlpKeyValue[] {
    const attrs: OtlpKeyValue[] = [
      { key: 'service.name', value: { stringValue: this.serviceName } },
    ];
    for (const [key, val] of Object.entries(this.resourceAttributes)) {
      attrs.push({ key, value: { stringValue: val } });
    }
    return attrs;
  }

  private async post(path: string, payload: unknown): Promise<void> {
    try {
      const body = JSON.stringify(payload);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.headers,
      };

      if (this.source) headers['X-Source'] = this.source;
      if (this.instanceId) headers['X-Instance-Id'] = this.instanceId;

      await fetch(`${this.endpoint}${path}`, {
        method: 'POST',
        headers,
        body,
      });
    } catch {
      // Silently fail — don't break the app if the telemetry server is down
    }
  }
}

/**
 * Create a new Abbacchio OTLP client instance
 */
export function createClient(options?: AbbacchioClientOptions): AbbacchioClient {
  return new AbbacchioClient(options);
}
