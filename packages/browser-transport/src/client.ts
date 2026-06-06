/**
 * Browser HTTP client for Abbacchio (OTLP native)
 * Sends logs to POST /v1/logs, metrics to POST /v1/metrics, traces to POST /v1/traces
 */


/**
 * OTLP severity numbers per OpenTelemetry spec.
 */
const PINO_TO_OTLP_SEVERITY: Record<number, { number: number; text: string }> = {
  10: { number: 1, text: 'TRACE' },
  20: { number: 5, text: 'DEBUG' },
  30: { number: 9, text: 'INFO' },
  40: { number: 13, text: 'WARN' },
  50: { number: 17, text: 'ERROR' },
  60: { number: 21, text: 'FATAL' },
};

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

function toOtlpAnyValue(val: unknown): OtlpAnyValue {
  if (typeof val === 'string') {
    return { stringValue: val.length > 2000 ? val.substring(0, 2000) + '...[TRUNCATED]' : val };
  }
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { intValue: val } : { doubleValue: val };
  }
  if (typeof val === 'boolean') return { boolValue: val };
  if (val === null || val === undefined) return { stringValue: '' };
  // For objects/arrays, JSON.stringify
  try {
    const str = JSON.stringify(val);
    return { stringValue: str.length > 2000 ? str.substring(0, 2000) + '...[TRUNCATED]' : str };
  } catch {
    const str = String(val);
    return { stringValue: str.length > 2000 ? str.substring(0, 2000) + '...[TRUNCATED]' : str };
  }
}

function toOtlpAttributes(obj: Record<string, unknown>): OtlpKeyValue[] {
  const attrs: OtlpKeyValue[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue;
    attrs.push({ key, value: toOtlpAnyValue(val) });
  }
  return attrs;
}

const INSTANCE_ID_STORAGE_KEY = 'abbacchio_instance_id';

/**
 * Return a stable per-browser instance id, persisted in localStorage so it
 * survives reloads. Falls back to an ephemeral id when storage is unavailable.
 */
function defaultBrowserInstanceId(): string | undefined {
  const random = () => 'web-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  try {
    if (typeof localStorage === 'undefined') return random();
    let id = localStorage.getItem(INSTANCE_ID_STORAGE_KEY);
    if (!id) {
      id = random();
      localStorage.setItem(INSTANCE_ID_STORAGE_KEY, id);
    }
    return id;
  } catch {
    return random();
  }
}

export interface AbbacchioClientOptions {
  /** Base URL of the OTLP server (e.g. "http://localhost:4002"). Logs go to {endpoint}/v1/logs */
  endpoint?: string;
  /** @deprecated Use `endpoint` instead */
  url?: string;
  /** Service name — maps to OTLP resource attribute `service.name`. Defaults to 'default' */
  serviceName?: string;
  /**
   * Self-declared emitter label sent on every request via the `X-Source` header.
   * Not cryptographically verified.
   */
  source?: string;
  /**
   * Self-declared unique instance id sent via the `X-Instance-Id` header.
   * Defaults to a random id persisted in localStorage (stable across reloads).
   */
  instanceId?: string;
  /** Additional OTLP resource attributes */
  resourceAttributes?: Record<string, string>;
  /** Number of log records to batch before sending. Defaults to 1000 */
  batchSize?: number;
  /** Interval in ms between flushes. Defaults to 2000 */
  flushInterval?: number;
  /** Additional headers to send with requests */
  headers?: Record<string, string>;
  /** Whether to send logs to the server. Defaults to true */
  enabled?: boolean;
}

export interface LogEntry {
  level: number;
  time: number;
  msg: string;
  name?: string;
  error?: {
    name?: string;
    message?: string;
    stack?: string;
    [key: string]: unknown;
  };
  network?: {
    method?: string;
    url?: string;
    type?: 'fetch' | 'xhr' | 'websocket';
    status?: number;
    duration?: number;
    requestBody?: unknown;
    requestHeaders?: unknown;
    payload?: unknown;
    event?: 'connect' | 'disconnect' | 'error' | 'message_in' | 'message_out';
  };
  caller?: {
    function?: string;
    file?: string;
    line?: number;
    column?: number;
  };
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
 * Browser HTTP client for Abbacchio (OTLP native).
 * Sends logs via POST /v1/logs in ExportLogsServiceRequest format.
 */
export class AbbacchioClient {
  private endpoint: string;
  private serviceName: string;
  private source?: string;
  private instanceId?: string;
  private resourceAttributes: Record<string, string>;
  private batchSize: number;
  private flushInterval: number;
  private headers: Record<string, string>;
  private enabled: boolean;

  private buffer: LogEntry[] = [];
  private metricBuffer: MetricRecord[] = [];
  private spanBuffer: SpanRecord[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private metricTimer: ReturnType<typeof setTimeout> | null = null;
  private spanTimer: ReturnType<typeof setTimeout> | null = null;
  private isClosed = false;

  constructor(options: AbbacchioClientOptions = {}) {
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
    this.source = options.source;
    this.instanceId = options.instanceId ?? defaultBrowserInstanceId();
    this.resourceAttributes = options.resourceAttributes || {};
    this.batchSize = options.batchSize || 1000;
    this.flushInterval = options.flushInterval || 2000;
    this.headers = options.headers || {};
    this.enabled = options.enabled ?? true;

    // Flush on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flush());
      window.addEventListener('pagehide', () => this.flush());
    }
  }

  enable(): void { this.enabled = true; }
  disable(): void { this.enabled = false; }
  isEnabled(): boolean { return this.enabled; }

  /** Add a log to the buffer and trigger send if needed */
  add(log: LogEntry): void {
    if (!this.enabled || this.isClosed) return;
    this.buffer.push(log);

    if (this.buffer.length >= this.batchSize) {
      this.flush();
    } else {
      this.scheduleSend();
    }
  }

  private scheduleSend(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.flushInterval);
  }

  /** Flush all buffers (logs, metrics, traces) */
  async flush(): Promise<void> {
    await Promise.all([
      this.flushLogs(),
      this.flushMetrics(),
      this.flushSpans(),
    ]);
  }

  async flushLogs(): Promise<void> {
    if (this.buffer.length === 0) return;

    const toSend = this.buffer;
    this.buffer = [];

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    await this.sendLogs(toSend);
  }

  private async sendLogs(logs: LogEntry[]): Promise<void> {
    try {
      const logRecords = logs.map((log) => {
        const { level, msg, message, time, name, ...extra } = log;
        const pinoLevel = typeof level === 'number' ? level : 30;
        const severity = PINO_TO_OTLP_SEVERITY[pinoLevel] || PINO_TO_OTLP_SEVERITY[30];
        const body = msg || (message as string) || '';
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
            scope: { name: '@abbacchio/browser-transport' },
            logRecords,
          }],
        }],
      };

      await this.post('/v1/logs', payload);
    } catch {
      // Silently fail
    }
  }

  // ─── Metrics ───────────────────────────────────────

  /** Add a metric data point to the buffer */
  addMetric(metric: MetricRecord): void {
    if (!this.enabled || this.isClosed) return;
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
    }, this.flushInterval);
  }

  async flushMetrics(): Promise<void> {
    if (this.metricBuffer.length === 0) return;
    const batch = this.metricBuffer;
    this.metricBuffer = [];
    if (this.metricTimer) {
      clearTimeout(this.metricTimer);
      this.metricTimer = null;
    }
    await this.sendMetrics(batch);
  }

  private async sendMetrics(metrics: MetricRecord[]): Promise<void> {
    try {
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
            aggregationTemporality: 2,
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
            scope: { name: '@abbacchio/browser-transport' },
            metrics: otlpMetrics,
          }],
        }],
      };

      await this.post('/v1/metrics', payload);
    } catch {
      // Silently fail
    }
  }

  // ─── Traces ────────────────────────────────────────

  /** Add a trace span to the buffer */
  addSpan(span: SpanRecord): void {
    if (!this.enabled || this.isClosed) return;
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
    }, this.flushInterval);
  }

  async flushSpans(): Promise<void> {
    if (this.spanBuffer.length === 0) return;
    const batch = this.spanBuffer;
    this.spanBuffer = [];
    if (this.spanTimer) {
      clearTimeout(this.spanTimer);
      this.spanTimer = null;
    }
    await this.sendSpans(batch);
  }

  private async sendSpans(spans: SpanRecord[]): Promise<void> {
    try {
      const otlpSpans = spans.map((s) => ({
        traceId: s.traceId,
        spanId: s.spanId,
        parentSpanId: s.parentSpanId,
        name: s.name,
        kind: s.kind ?? 1,
        startTimeUnixNano: s.startTimeUnixNano,
        endTimeUnixNano: s.endTimeUnixNano,
        attributes: s.attributes ? toOtlpAttributes(s.attributes) : [],
        status: s.status,
      }));

      const payload = {
        resourceSpans: [{
          resource: { attributes: this.buildResourceAttributes() },
          scopeSpans: [{
            scope: { name: '@abbacchio/browser-transport' },
            spans: otlpSpans,
          }],
        }],
      };

      await this.post('/v1/traces', payload);
    } catch {
      // Silently fail
    }
  }

  // ─── Shared ────────────────────────────────────────

  async close(): Promise<void> {
    this.isClosed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.metricTimer) {
      clearTimeout(this.metricTimer);
      this.metricTimer = null;
    }
    if (this.spanTimer) {
      clearTimeout(this.spanTimer);
      this.spanTimer = null;
    }
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
  }

  /** Update client configuration */
  configure(options: Partial<AbbacchioClientOptions>): void {
    if (options.endpoint !== undefined) this.endpoint = options.endpoint;
    if (options.url !== undefined && !options.endpoint) {
      try {
        const u = new URL(options.url);
        this.endpoint = `${u.protocol}//${u.host}`;
      } catch {
        this.endpoint = options.url;
      }
    }
    if (options.serviceName !== undefined) this.serviceName = options.serviceName;
    if (options.source !== undefined) this.source = options.source;
    if (options.instanceId !== undefined) this.instanceId = options.instanceId;
    if (options.resourceAttributes !== undefined) this.resourceAttributes = options.resourceAttributes;
    if (options.enabled !== undefined) this.enabled = options.enabled;
    if (options.batchSize !== undefined) this.batchSize = options.batchSize;
    if (options.flushInterval !== undefined) this.flushInterval = options.flushInterval;
    if (options.headers !== undefined) this.headers = options.headers;
  }
}

/**
 * Create a new Abbacchio OTLP client instance
 */
export function createClient(options?: AbbacchioClientOptions): AbbacchioClient {
  return new AbbacchioClient(options);
}
