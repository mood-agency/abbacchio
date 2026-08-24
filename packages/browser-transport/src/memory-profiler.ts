const DEFAULT_INTERVAL_MS = 30_000;
const MIN_INTERVAL_MS = 1_000;
const DEFAULT_MAX_SAMPLES = 1_440;
const MAX_SAMPLE_CAPACITY = 10_000;
const SCHEMA_VERSION = 2;
const DEFAULT_METRIC_PREFIX = 'browser.memory';

interface ChromePerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export interface MemoryHeapSample {
  usedBytes: number | null;
  totalBytes: number | null;
  limitBytes: number | null;
}

export interface MemoryDomSample {
  elements: number;
  canvases: number;
  images: number;
  [name: string]: number;
}

export type MemoryProfilerValues = Record<string, unknown>;

export interface MemoryProfilerSample {
  schemaVersion: typeof SCHEMA_VERSION;
  /**
   * Identifies one profiling run. Every sample recorded between `start()` and
   * the next `start()` shares it, so persisted samples can be grouped back into
   * a single run when queried later.
   */
  sessionId: string;
  sequence: number;
  timestamp: string;
  elapsedMs: number;
  kind: 'sample' | 'mark';
  label: string | null;
  heap: MemoryHeapSample;
  dom: MemoryDomSample;
  values: MemoryProfilerValues;
}

export interface MemoryProfilerStartOptions {
  intervalMs?: number;
  maxSamples?: number;
  label?: string;
  reset?: boolean;
}

export interface MemoryProfilerStatus {
  /** Current run identifier — the grouping key for persisted samples. */
  sessionId: string;
  running: boolean;
  intervalMs: number;
  maxSamples: number;
  retainedSamples: number;
  startedAt: string | null;
}

export interface MemoryProfilerApi {
  start: (options?: MemoryProfilerStartOptions) => MemoryProfilerStatus;
  stop: () => MemoryProfilerStatus;
  sample: (label?: string) => MemoryProfilerSample;
  mark: (label: string) => MemoryProfilerSample;
  status: () => MemoryProfilerStatus;
  getSamples: () => MemoryProfilerSample[];
  clear: () => void;
  download: (filename?: string) => void;
  dispose: () => void;
}

export interface MemoryProfilerOptions {
  /** Additional DOM counters keyed by the name stored in each sample. */
  domSelectors?: Record<string, string>;
  /** Application-specific, serializable values to copy into each sample. */
  collectValues?: () => MemoryProfilerValues;
  /** Prefix used for downloaded JSONL files. Defaults to `abbacchio-memory`. */
  filenamePrefix?: string;
  /**
   * Called with a copy of every recorded sample. Use it to forward samples to a
   * durable sink (for example `toMemoryProfilerMetrics` plus `addMetric`) so a
   * run outlives the page. Failures are isolated: a throwing sink never stops
   * sampling and never drops the in-memory history.
   */
  onSample?: (sample: MemoryProfilerSample) => void;
}

/** Per-run state passed to the standalone sample collector. */
export interface MemoryProfilerSampleContext extends MemoryProfilerOptions {
  sessionId?: string;
}

export interface InstallMemoryProfilerOptions extends MemoryProfilerOptions {
  /** Global console API name. Defaults to `__abbacchioMemory`. */
  globalName?: string;
  /** Optional message written after installation. Set to false to disable it. */
  readyMessage?: string | false;
  /** Pass `import.meta.hot` to clean up the profiler when its owner is replaced. */
  hot?: {
    dispose(callback: () => void): void;
  };
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value!)));
}

function getChromeMemory(performanceObject: Performance): ChromePerformanceMemory | undefined {
  return (performanceObject as Performance & { memory?: ChromePerformanceMemory }).memory;
}

function copySerializableValues(values: MemoryProfilerValues): MemoryProfilerValues {
  if (Object.keys(values).length === 0) return {};

  try {
    return JSON.parse(JSON.stringify(values)) as MemoryProfilerValues;
  } catch {
    throw new TypeError('Memory profiler values must be JSON-serializable');
  }
}

function createSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the non-cryptographic identifier below.
  }
  return `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function copySample(sample: MemoryProfilerSample): MemoryProfilerSample {
  return {
    ...sample,
    heap: { ...sample.heap },
    dom: { ...sample.dom },
    values: copySerializableValues(sample.values),
  };
}

export function collectMemoryProfilerSample(
  sequence: number,
  startedAtMs: number,
  kind: MemoryProfilerSample['kind'] = 'sample',
  label: string | null = null,
  nowMs: number = Date.now(),
  options: MemoryProfilerSampleContext = {},
): MemoryProfilerSample {
  const memory = getChromeMemory(performance);
  const dom: MemoryDomSample = {
    elements: document.getElementsByTagName('*').length,
    canvases: document.getElementsByTagName('canvas').length,
    images: document.images.length,
  };

  for (const [name, selector] of Object.entries(options.domSelectors ?? {})) {
    dom[name] = document.querySelectorAll(selector).length;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    sessionId: options.sessionId ?? '',
    sequence,
    timestamp: new Date(nowMs).toISOString(),
    elapsedMs: Math.max(0, nowMs - startedAtMs),
    kind,
    label,
    heap: {
      usedBytes: memory?.usedJSHeapSize ?? null,
      totalBytes: memory?.totalJSHeapSize ?? null,
      limitBytes: memory?.jsHeapSizeLimit ?? null,
    },
    dom,
    values: copySerializableValues(options.collectValues?.() ?? {}),
  };
}

export function serializeMemoryProfilerSamples(
  samples: readonly MemoryProfilerSample[],
): string {
  if (samples.length === 0) return '';
  return `${samples.map((sample) => JSON.stringify(sample)).join('\n')}\n`;
}

/** One numeric series point derived from a sample. */
export interface MemoryProfilerMetric {
  name: string;
  value: number;
  attributes: Record<string, string>;
}

export interface MemoryProfilerMetricOptions {
  /** Metric name prefix. Defaults to `browser.memory`. */
  prefix?: string;
  /** Extra attributes merged into every produced point. */
  attributes?: Record<string, string>;
}

function toSnakeCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function flattenNumericValues(
  values: MemoryProfilerValues,
  prefix: string,
  target: Array<{ name: string; value: number }>,
): void {
  for (const [key, value] of Object.entries(values)) {
    const name = `${prefix}.${toSnakeCase(key)}`;

    if (typeof value === 'number') {
      if (Number.isFinite(value)) target.push({ name, value });
      continue;
    }
    if (typeof value === 'boolean') {
      target.push({ name, value: value ? 1 : 0 });
      continue;
    }
    // Arrays are skipped on purpose: per-entry names would make metric
    // cardinality grow without bound. Use the JSONL export for that detail.
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenNumericValues(value as MemoryProfilerValues, name, target);
    }
  }
}

/**
 * Converts a sample into gauge points so a run can be persisted in Abbacchio
 * and queried after the page is gone. Null heap readings and array values are
 * omitted; booleans become 1/0.
 */
export function toMemoryProfilerMetrics(
  sample: MemoryProfilerSample,
  options: MemoryProfilerMetricOptions = {},
): MemoryProfilerMetric[] {
  const prefix = options.prefix ?? DEFAULT_METRIC_PREFIX;
  const points: Array<{ name: string; value: number }> = [];

  if (sample.heap.usedBytes !== null) {
    points.push({ name: `${prefix}.heap.used_bytes`, value: sample.heap.usedBytes });
  }
  if (sample.heap.totalBytes !== null) {
    points.push({ name: `${prefix}.heap.total_bytes`, value: sample.heap.totalBytes });
  }
  if (sample.heap.limitBytes !== null) {
    points.push({ name: `${prefix}.heap.limit_bytes`, value: sample.heap.limitBytes });
  }

  for (const [key, value] of Object.entries(sample.dom)) {
    if (Number.isFinite(value)) points.push({ name: `${prefix}.dom.${toSnakeCase(key)}`, value });
  }

  flattenNumericValues(sample.values, prefix, points);

  const attributes: Record<string, string> = {
    ...options.attributes,
    sessionId: sample.sessionId,
    kind: sample.kind,
    sequence: String(sample.sequence),
  };
  if (sample.label !== null) attributes.label = sample.label;

  return points.map((point) => ({ ...point, attributes }));
}

export class MemoryProfiler {
  private samples: MemoryProfilerSample[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private intervalMs = DEFAULT_INTERVAL_MS;
  private maxSamples = DEFAULT_MAX_SAMPLES;
  private startedAtMs = 0;
  private startedAt: string | null = null;
  private sequence = 0;
  private sessionId = createSessionId();

  constructor(private readonly options: MemoryProfilerOptions = {}) {}

  start(options: MemoryProfilerStartOptions = {}): MemoryProfilerStatus {
    this.stop();
    this.intervalMs = clampInteger(
      options.intervalMs,
      DEFAULT_INTERVAL_MS,
      MIN_INTERVAL_MS,
      60 * 60 * 1_000,
    );
    this.maxSamples = clampInteger(
      options.maxSamples,
      DEFAULT_MAX_SAMPLES,
      1,
      MAX_SAMPLE_CAPACITY,
    );
    if (options.reset !== false) this.clear();

    // Each start() begins a new run. Samples kept by `reset: false` keep the
    // previous run's identifier, which is where they were actually recorded.
    this.sessionId = createSessionId();
    this.startedAtMs = Date.now();
    this.startedAt = new Date(this.startedAtMs).toISOString();
    this.pushSample('sample', options.label ?? 'start');
    this.timer = setInterval(() => this.pushSample('sample', null), this.intervalMs);
    return this.status();
  }

  stop(): MemoryProfilerStatus {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this.status();
  }

  sample(label?: string): MemoryProfilerSample {
    return this.pushSample('sample', label ?? null);
  }

  mark(label: string): MemoryProfilerSample {
    return this.pushSample('mark', label);
  }

  status(): MemoryProfilerStatus {
    return {
      sessionId: this.sessionId,
      running: this.timer !== null,
      intervalMs: this.intervalMs,
      maxSamples: this.maxSamples,
      retainedSamples: this.samples.length,
      startedAt: this.startedAt,
    };
  }

  getSamples(): MemoryProfilerSample[] {
    return this.samples.map(copySample);
  }

  clear(): void {
    this.samples = [];
    this.sequence = 0;
  }

  download(filename?: string): void {
    const contents = serializeMemoryProfilerSamples(this.samples);
    const blob = new Blob([contents], { type: 'application/x-ndjson' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download =
      filename ??
      `${this.options.filenamePrefix ?? 'abbacchio-memory'}-${new Date().toISOString().replace(/:/g, '-')}.jsonl`;
    link.click();
    queueMicrotask(() => URL.revokeObjectURL(objectUrl));
  }

  dispose(): void {
    this.stop();
    this.clear();
  }

  private pushSample(
    kind: MemoryProfilerSample['kind'],
    label: string | null,
  ): MemoryProfilerSample {
    if (this.startedAt === null) {
      this.startedAtMs = Date.now();
      this.startedAt = new Date(this.startedAtMs).toISOString();
    }
    const sample = collectMemoryProfilerSample(
      this.sequence++,
      this.startedAtMs,
      kind,
      label,
      Date.now(),
      { ...this.options, sessionId: this.sessionId },
    );
    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }

    if (this.options.onSample) {
      // A failing sink must not interrupt the run or lose the local history.
      // The sink gets its own copy so mutating it cannot affect the caller.
      try {
        this.options.onSample(copySample(sample));
      } catch {
        // Intentionally ignored; the sink owns its own error reporting.
      }
    }
    return copySample(sample);
  }
}

export function installMemoryProfiler(
  options: InstallMemoryProfilerOptions = {},
): MemoryProfilerApi {
  const globalName = options.globalName ?? '__abbacchioMemory';
  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  const previous = globals[globalName] as MemoryProfilerApi | undefined;
  previous?.dispose?.();

  const profiler = new MemoryProfiler(options);
  const api: MemoryProfilerApi = {
    start: (startOptions) => profiler.start(startOptions),
    stop: () => profiler.stop(),
    sample: (label) => profiler.sample(label),
    mark: (label) => profiler.mark(label),
    status: () => profiler.status(),
    getSamples: () => profiler.getSamples(),
    clear: () => profiler.clear(),
    download: (filename) => profiler.download(filename),
    dispose: () => {
      profiler.dispose();
      if (globals[globalName] === api) delete globals[globalName];
    },
  };

  globals[globalName] = api;
  if (options.readyMessage !== false) {
    console.info(
      options.readyMessage ??
        `[abbacchio:memory] Profiler ready. Start with ${globalName}.start()`,
    );
  }
  options.hot?.dispose(() => api.dispose());
  return api;
}
