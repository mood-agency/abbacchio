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
  /**
   * Max records held per buffer (logs/metrics/histograms/spans) before excess
   * is dropped instead of buffered. Bounds memory under a runaway producer.
   * Defaults to 10000.
   */
  maxBufferSize?: number;
  /**
   * Max data points accepted per second across all signals (intake throttle).
   * Protects the server from a producer that emits one point per streamed line
   * (e.g. ffprobe progress). Excess is dropped locally with a throttled warning.
   * Set to 0 to disable. Defaults to 2000.
   */
  maxPointsPerSecond?: number;
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
  private maxBufferSize: number;

  // Intake throttle (token bucket) — caps points accepted per second.
  private maxPointsPerSecond: number;
  private intakeTokens: number;
  private intakeLastRefill: number = Date.now();

  // 429 backoff — while paused, flushes are deferred instead of hammering.
  private pausedUntil = 0;
  private static BASE_BACKOFF_MS = 1000;
  private static MAX_BACKOFF_MS = 30000;
  private backoffMs = AbbacchioClient.BASE_BACKOFF_MS;
  private closed = false;

  // Throttled drop reporting.
  private droppedSinceWarn = 0;
  private lastDropWarn = 0;

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
    this.maxBufferSize = options.maxBufferSize ?? 10000;
    this.maxPointsPerSecond = options.maxPointsPerSecond ?? 2000;
    this.intakeTokens = this.maxPointsPerSecond;
  }

  /** Token-bucket intake check. Returns false when over the per-second cap. */
  private intakeOK(): boolean {
    if (this.maxPointsPerSecond <= 0) return true;
    const now = Date.now();
    const elapsedSec = (now - this.intakeLastRefill) / 1000;
    if (elapsedSec > 0) {
      this.intakeTokens = Math.min(
        this.maxPointsPerSecond,
        this.intakeTokens + elapsedSec * this.maxPointsPerSecond,
      );
      this.intakeLastRefill = now;
    }
    if (this.intakeTokens >= 1) {
      this.intakeTokens -= 1;
      return true;
    }
    return false;
  }

  /** Whether outbound sends are paused due to a recent 429. */
  private isPaused(): boolean {
    return Date.now() < this.pausedUntil;
  }

  /** Record a dropped record and emit a single warning at most every 5s. */
  private noteDropped(count = 1): void {
    this.droppedSinceWarn += count;
    const now = Date.now();
    if (now - this.lastDropWarn > 5000) {
      // eslint-disable-next-line no-console
      console.warn(
        `[abbacchio] dropped ${this.droppedSinceWarn} telemetry records (intake rate limit or buffer cap)`,
      );
      this.droppedSinceWarn = 0;
      this.lastDropWarn = now;
    }
  }

  /** True if the record may be buffered; otherwise it is dropped + counted. */
  private admit(bufferLength: number): boolean {
    if (!this.intakeOK() || bufferLength >= this.maxBufferSize) {
      this.noteDropped();
      return false;
    }
    return true;
  }

  /**
   * Put a rate-limited batch back in front of whatever arrived meanwhile,
   * keeping the newest records within maxBufferSize. After close() the batch
   * is dropped instead, since no timer will retry it.
   */
  private requeue<T>(batch: T[], current: T[]): T[] {
    if (this.closed) {
      this.noteDropped(batch.length);
      return current;
    }
    const merged = batch.concat(current);
    const excess = merged.length - this.maxBufferSize;
    if (excess > 0) {
      this.noteDropped(excess);
      return merged.slice(excess);
    }
    return merged;
  }

  /**
   * Arm a flush timer. Retries after a 429 are unref'd so a server that keeps
   * rate-limiting cannot hold the host process open; ordinary flushes stay
   * ref'd so a script that logs and exits still delivers its last batch.
   */
  private armTimer(fn: () => void, retry: boolean): ReturnType<typeof setTimeout> {
    const timer = setTimeout(fn, this.interval);
    if (retry) (timer as { unref?: () => void }).unref?.();
    return timer;
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
    if (!this.admit(this.logBuffer.length)) return;
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
      if (!this.admit(this.logBuffer.length)) continue;
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
    if (this.isPaused()) {
      this.addBatch(logs);
      return;
    }
    if (await this.sendLogs(logs as LogRecord[])) {
      this.logBuffer = this.requeue(logs as LogRecord[], this.logBuffer);
      if (!this.closed) this.scheduleLogFlush(true);
    }
  }

  private scheduleLogFlush(retry = false): void {
    if (this.logTimer) return;
    this.logTimer = this.armTimer(() => {
      this.logTimer = null;
      this.flushLogs();
    }, retry);
  }

  async flushLogs(force = false): Promise<void> {
    if (this.logBuffer.length === 0) return;
    if (this.isPaused() && !force) { this.scheduleLogFlush(true); return; }
    const batch = this.logBuffer;
    this.logBuffer = [];
    if (await this.sendLogs(batch)) {
      this.logBuffer = this.requeue(batch, this.logBuffer);
      if (!this.closed) this.scheduleLogFlush(true);
    }
  }

  /** Returns true when the server rate-limited the batch (429). */
  private async sendLogs(logs: LogRecord[]): Promise<boolean> {
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

    return this.post('/v1/logs', payload);
  }

  // ─── Metrics ───────────────────────────────────────

  /** Add a metric data point to the buffer */
  addMetric(metric: MetricRecord): void {
    if (!this.enabled) return;
    if (!this.admit(this.metricBuffer.length)) return;
    this.metricBuffer.push(metric);

    if (this.metricBuffer.length >= this.batchSize) {
      this.flushMetrics();
    } else {
      this.scheduleMetricFlush();
    }
  }

  private scheduleMetricFlush(retry = false): void {
    if (this.metricTimer) return;
    this.metricTimer = this.armTimer(() => {
      this.metricTimer = null;
      this.flushMetrics();
    }, retry);
  }

  async flushMetrics(force = false): Promise<void> {
    if (this.metricBuffer.length === 0) return;
    if (this.isPaused() && !force) { this.scheduleMetricFlush(true); return; }
    const batch = this.metricBuffer;
    this.metricBuffer = [];
    if (await this.sendMetrics(batch)) {
      this.metricBuffer = this.requeue(batch, this.metricBuffer);
      if (!this.closed) this.scheduleMetricFlush(true);
    }
  }

  /** Returns true when the server rate-limited the batch (429). */
  private async sendMetrics(metrics: MetricRecord[]): Promise<boolean> {
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

    return this.post('/v1/metrics', payload);
  }

  // ─── Histograms ─────────────────────────────────────

  private static DEFAULT_BOUNDS = [5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 10000];

  /** Add a histogram observation to the buffer */
  addHistogram(record: HistogramRecord): void {
    if (!this.enabled) return;
    if (!this.admit(this.histogramBuffer.length)) return;
    this.histogramBuffer.push(record);

    if (this.histogramBuffer.length >= this.batchSize) {
      this.flushHistograms();
    } else {
      this.scheduleHistogramFlush();
    }
  }

  private scheduleHistogramFlush(retry = false): void {
    if (this.histogramTimer) return;
    this.histogramTimer = this.armTimer(() => {
      this.histogramTimer = null;
      this.flushHistograms();
    }, retry);
  }

  async flushHistograms(force = false): Promise<void> {
    if (this.histogramBuffer.length === 0) return;
    if (this.isPaused() && !force) { this.scheduleHistogramFlush(true); return; }
    const batch = this.histogramBuffer;
    this.histogramBuffer = [];
    if (await this.sendHistograms(batch)) {
      this.histogramBuffer = this.requeue(batch, this.histogramBuffer);
      if (!this.closed) this.scheduleHistogramFlush(true);
    }
  }

  /** Returns true when the server rate-limited the batch (429). */
  private async sendHistograms(records: HistogramRecord[]): Promise<boolean> {
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

    return this.post('/v1/metrics', payload);
  }

  // ─── Traces ────────────────────────────────────────

  /** Add a trace span to the buffer */
  addSpan(span: SpanRecord): void {
    if (!this.enabled) return;
    if (!this.admit(this.spanBuffer.length)) return;
    this.spanBuffer.push(span);

    if (this.spanBuffer.length >= this.batchSize) {
      this.flushSpans();
    } else {
      this.scheduleSpanFlush();
    }
  }

  private scheduleSpanFlush(retry = false): void {
    if (this.spanTimer) return;
    this.spanTimer = this.armTimer(() => {
      this.spanTimer = null;
      this.flushSpans();
    }, retry);
  }

  async flushSpans(force = false): Promise<void> {
    if (this.spanBuffer.length === 0) return;
    if (this.isPaused() && !force) { this.scheduleSpanFlush(true); return; }
    const batch = this.spanBuffer;
    this.spanBuffer = [];
    if (await this.sendSpans(batch)) {
      this.spanBuffer = this.requeue(batch, this.spanBuffer);
      if (!this.closed) this.scheduleSpanFlush(true);
    }
  }

  /** Returns true when the server rate-limited the batch (429). */
  private async sendSpans(spans: SpanRecord[]): Promise<boolean> {
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

    return this.post('/v1/traces', payload);
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

  /**
   * Close the client and flush any remaining data. Sends even while paused by
   * a 429: a deferred timer would never fire once the host process exits.
   */
  async close(): Promise<void> {
    this.closed = true;
    if (this.logTimer) { clearTimeout(this.logTimer); this.logTimer = null; }
    if (this.metricTimer) { clearTimeout(this.metricTimer); this.metricTimer = null; }
    if (this.histogramTimer) { clearTimeout(this.histogramTimer); this.histogramTimer = null; }
    if (this.spanTimer) { clearTimeout(this.spanTimer); this.spanTimer = null; }
    await Promise.all([
      this.flushLogs(true),
      this.flushMetrics(true),
      this.flushHistograms(true),
      this.flushSpans(true),
    ]);
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

  /** Returns true when the server rate-limited the request (429). */
  private async post(path: string, payload: unknown): Promise<boolean> {
    try {
      const body = JSON.stringify(payload);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.headers,
      };

      if (this.source) headers['X-Source'] = this.source;
      if (this.instanceId) headers['X-Instance-Id'] = this.instanceId;

      const res = await fetch(`${this.endpoint}${path}`, {
        method: 'POST',
        headers,
        body,
      });

      if (res.status === 429) {
        // Honor Retry-After when present; otherwise exponential backoff (capped).
        const retryAfter = Number(res.headers.get('retry-after'));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : this.backoffMs;
        this.pausedUntil = Date.now() + backoff;
        this.backoffMs = Math.min(this.backoffMs * 2, AbbacchioClient.MAX_BACKOFF_MS);
        return true;
      }
      if (res.ok) {
        this.backoffMs = AbbacchioClient.BASE_BACKOFF_MS;
      }
    } catch {
      // Silently fail — don't break the app if the telemetry server is down
    }
    return false;
  }
}

/**
 * Create a new Abbacchio OTLP client instance
 */
export function createClient(options?: AbbacchioClientOptions): AbbacchioClient {
  return new AbbacchioClient(options);
}
