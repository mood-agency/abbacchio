/**
 * SQLite Database Layer
 * Manages log, metric, and trace persistence using Bun's native SQLite
 */
import { Database } from 'bun:sqlite';
import { mkdirSync, statSync, existsSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import type {
  LogEntry, MetricDataPoint, TraceSpan,
} from '../types.js';

export interface DatabaseConfig {
  path: string;
  walMode: boolean;
  maxLogs: number; // 0 = unlimited
  ttlMs: number; // 0 = unlimited (time to live in milliseconds)
  ephemeral: boolean;
}

export interface QueryOpts {
  limit?: number;
  offset?: number;
  channel?: string;
  level?: number;
  levels?: string[];
  namespaces?: string[];
  search?: string;
  since?: number;
  until?: number;
  order?: 'asc' | 'desc';
}

export interface QueryResult {
  logs: LogEntry[];
  count: number;
  total: number;
  limit: number;
  offset: number;
}

export interface MetricQueryOpts {
  limit?: number;
  offset?: number;
  channel?: string;
  name?: string;
  type?: string;
  since?: number;
  until?: number;
  order?: 'asc' | 'desc';
}

export interface MetricQueryResult {
  metrics: MetricDataPoint[];
  count: number;
  total: number;
  limit: number;
  offset: number;
}

export interface TraceQueryOpts {
  limit?: number;
  offset?: number;
  channel?: string;
  traceId?: string;
  name?: string;
  since?: number;
  until?: number;
  order?: 'asc' | 'desc';
}

export interface TraceQueryResult {
  spans: TraceSpan[];
  count: number;
  total: number;
  limit: number;
  offset: number;
}

export interface ChannelStats {
  name: string;
  count: number;
  lastActivity: number;
}

export interface DbStats {
  totalLogs: number;
  dbSizeBytes: number;
  channels: ChannelStats[];
}

function buildFtsQuery(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  return tokens
    .map(t => {
      const sanitized = t.replace(/["'*(){}[\]^~\\:+\-!,;.]/g, '');
      if (!sanitized) return '';
      return '"' + sanitized + '"' + '*';
    })
    .filter(Boolean)
    .join(' AND ');
}

function addLevelAndNamespaceConditions(
  conditions: string[],
  params: Record<string, any>,
  levels?: string[],
  namespaces?: string[],
) {
  if (levels && levels.length > 0) {
    const placeholders = levels.map((_, i) => `$lvl${i}`);
    conditions.push(`level_label IN (${placeholders.join(', ')})`);
    levels.forEach((lbl, i) => { params[`$lvl${i}`] = lbl; });
  }
  if (namespaces && namespaces.length > 0) {
    const hasNone = namespaces.includes('(none)');
    const named = namespaces.filter(n => n !== '(none)');
    const parts: string[] = [];
    if (hasNone) parts.push('namespace IS NULL');
    if (named.length > 0) {
      const placeholders = named.map((_, i) => `$ns${i}`);
      parts.push(`namespace IN (${placeholders.join(', ')})`);
      named.forEach((ns, i) => { params[`$ns${i}`] = ns; });
    }
    conditions.push(`(${parts.join(' OR ')})`);
  }
}

function getDefaultConfig(): DatabaseConfig {
  return {
    path: process.env.SQLITE_PATH || './data/logs.db',
    walMode: process.env.SQLITE_WAL !== 'false',
    maxLogs: parseInt(process.env.SQLITE_MAX_LOGS || '100000', 10),
    ttlMs: parseInt(process.env.SQLITE_TTL_MS || '0', 10),
    ephemeral: process.env.SQLITE_EPHEMERAL === 'true',
  };
}

export class LogDatabase {
  private db: Database;
  private readonlyDb: Database;
  private config: DatabaseConfig;

  // Prepared statements
  private insertLogStmt!: ReturnType<Database['prepare']>;
  private insertMetricStmt!: ReturnType<Database['prepare']>;
  private insertSpanStmt!: ReturnType<Database['prepare']>;

  // Pruning state
  private pruneTimer: ReturnType<typeof setInterval>;

  // Buffering state
  private logQueue: LogEntry[] = [];
  private metricQueue: MetricDataPoint[] = [];
  private spanQueue: TraceSpan[] = [];
  private flushTimer: ReturnType<typeof setInterval>;
  private flushInterval = parseInt(process.env.FLUSH_INTERVAL || '100', 10);
  private maxBufferSize = 1000;

  constructor(config: Partial<DatabaseConfig> = {}) {
    this.config = { ...getDefaultConfig(), ...config };

    // Ensure directory exists
    const dir = dirname(this.config.path);
    mkdirSync(dir, { recursive: true });

    // Ephemeral mode: Delete DB if it exists
    if (this.config.ephemeral && existsSync(this.config.path)) {
      try {
        unlinkSync(this.config.path);
        console.log(`[Database] Ephemeral mode: Deleted existing DB at ${this.config.path}`);
      } catch (err) {
        console.warn(`[Database] Failed to delete ephemeral DB: ${err}`);
      }
    }

    this.db = new Database(this.config.path);
    if (this.config.path === ':memory:') {
      this.readonlyDb = this.db;
    } else {
      this.readonlyDb = new Database(this.config.path, { readonly: true });
    }

    // Performance pragmas for high-throughput
    if (this.config.walMode) {
      this.db.run('PRAGMA journal_mode = WAL');
      this.db.run('PRAGMA synchronous = OFF');
    } else {
      this.db.run('PRAGMA journal_mode = MEMORY');
      this.db.run('PRAGMA synchronous = OFF');
    }
    // RAM footprint pragmas (env-tunable; lower these to use less memory).
    // cache_size is in KiB when negative; mmap_size in bytes. Set either to 0 to disable.
    const cacheSize = parseInt(process.env.SQLITE_CACHE_SIZE || '-64000', 10); // 64MB cache
    const mmapSize = parseInt(process.env.SQLITE_MMAP_SIZE || '268435456', 10); // 256MB memory-mapped I/O
    this.db.run(`PRAGMA cache_size = ${cacheSize}`);
    this.db.run('PRAGMA temp_store = MEMORY');
    this.db.run(`PRAGMA mmap_size = ${mmapSize}`);
    this.db.run('PRAGMA page_size = 8192');           // Larger pages

    // Incremental auto-vacuum so retention pruning returns freed disk to the OS.
    // auto_vacuum only takes effect on an empty DB or after a full VACUUM, so we
    // set it before createTables() and convert any pre-existing DB exactly once.
    if (this.config.path !== ':memory:') {
      const current = (this.db.prepare('PRAGMA auto_vacuum').get() as { auto_vacuum: number }).auto_vacuum;
      this.db.run('PRAGMA auto_vacuum = INCREMENTAL');
      if (current !== 2) {
        // 2 = INCREMENTAL. Rebuild existing DB to apply it (cheap on a fresh/empty file).
        this.db.run('VACUUM');
      }
    }

    this.createTables();
    this.prepareStatements();

    // Background pruning
    this.pruneTimer = setInterval(() => this.pruneIfNeeded(), 30_000);

    // Background flush
    this.flushTimer = setInterval(() => this.flush(), this.flushInterval);
  }

  /**
   * Add a column to a table if it doesn't already exist (idempotent migration).
   */
  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (cols.some((c) => c.name === column)) return;
    this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  /**
   * Map a raw logs row to a LogEntry.
   */
  private rowToLog(row: any): LogEntry {
    return {
      id: row.id,
      level: row.level,
      levelLabel: row.level_label as LogEntry['levelLabel'],
      time: row.time,
      msg: row.msg,
      namespace: row.namespace || undefined,
      channel: row.channel,
      data: JSON.parse(row.data),
      traceId: row.trace_id || undefined,
      spanId: row.span_id || undefined,
      source: row.source || undefined,
      instanceId: row.instance_id || undefined,
      sourceVerified: row.source_verified === 1,
    };
  }

  private createTables(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        level INTEGER NOT NULL,
        level_label TEXT NOT NULL,
        time INTEGER NOT NULL,
        msg TEXT NOT NULL DEFAULT '',
        namespace TEXT,
        channel TEXT NOT NULL DEFAULT 'default',
        data TEXT DEFAULT '{}',
        trace_id TEXT,
        span_id TEXT,
        source TEXT,
        instance_id TEXT,
        source_verified INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Migration: add emitter-identity columns to pre-existing tables.
    this.addColumnIfMissing('logs', 'source', 'TEXT');
    this.addColumnIfMissing('logs', 'instance_id', 'TEXT');
    this.addColumnIfMissing('logs', 'source_verified', 'INTEGER NOT NULL DEFAULT 0');

    this.db.run('CREATE INDEX IF NOT EXISTS idx_logs_channel_time ON logs(channel, time DESC)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(time DESC)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_logs_trace_id ON logs(trace_id)');

    // FTS5 full-text search index on msg and data columns
    const ftsExists = this.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='logs_fts'"
    ).get();

    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts USING fts5(
        msg, data,
        content=logs,
        content_rowid=rowid,
        tokenize='unicode61 remove_diacritics 2'
      )
    `);

    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS logs_fts_insert AFTER INSERT ON logs BEGIN
        INSERT INTO logs_fts(rowid, msg, data) VALUES (new.rowid, new.msg, new.data);
      END
    `);

    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS logs_fts_delete AFTER DELETE ON logs BEGIN
        INSERT INTO logs_fts(logs_fts, rowid, msg, data) VALUES('delete', old.rowid, old.msg, old.data);
      END
    `);

    if (!ftsExists) {
      this.db.run("INSERT INTO logs_fts(logs_fts) VALUES('rebuild')");
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        unit TEXT,
        type TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'default',
        time_unix_nano INTEGER NOT NULL,
        value REAL NOT NULL,
        attributes TEXT DEFAULT '{}'
      )
    `);

    this.db.run('CREATE INDEX IF NOT EXISTS idx_metrics_channel_time ON metrics(channel, time_unix_nano DESC)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(name)');

    this.db.run(`
      CREATE TABLE IF NOT EXISTS traces (
        trace_id TEXT NOT NULL,
        span_id TEXT NOT NULL,
        parent_span_id TEXT,
        name TEXT NOT NULL,
        start_time_ms INTEGER NOT NULL,
        end_time_ms INTEGER NOT NULL,
        channel TEXT NOT NULL DEFAULT 'default',
        attributes TEXT DEFAULT '{}',
        status_code INTEGER,
        status_message TEXT,
        PRIMARY KEY (trace_id, span_id)
      )
    `);

    this.db.run('CREATE INDEX IF NOT EXISTS idx_traces_channel ON traces(channel, start_time_ms DESC)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_traces_trace_id ON traces(trace_id)');
  }

  private prepareStatements(): void {
    this.insertLogStmt = this.db.prepare(`
      INSERT OR IGNORE INTO logs (id, level, level_label, time, msg, namespace, channel, data, trace_id, span_id, source, instance_id, source_verified)
      VALUES ($id, $level, $levelLabel, $time, $msg, $namespace, $channel, $data, $traceId, $spanId, $source, $instanceId, $sourceVerified)
    `);

    this.insertMetricStmt = this.db.prepare(`
      INSERT INTO metrics (name, description, unit, type, channel, time_unix_nano, value, attributes)
      VALUES ($name, $description, $unit, $type, $channel, $timeUnixNano, $value, $attributes)
    `);

    this.insertSpanStmt = this.db.prepare(`
      INSERT OR REPLACE INTO traces (trace_id, span_id, parent_span_id, name, start_time_ms, end_time_ms, channel, attributes, status_code, status_message)
      VALUES ($traceId, $spanId, $parentSpanId, $name, $startTimeMs, $endTimeMs, $channel, $attributes, $statusCode, $statusMessage)
    `);
  }

  // ──────── LOGS ────────

  insert(entry: LogEntry): void {
    this.logQueue.push(entry);
    if (this.logQueue.length >= this.maxBufferSize) this.flush();
  }

  insertBatch(entries: LogEntry[]): void {
    this.logQueue.push(...entries);
    if (this.logQueue.length >= this.maxBufferSize) this.flush();
  }

  // ──────── METRICS ────────

  queueMetric(metric: MetricDataPoint): void {
    this.metricQueue.push(metric);
    if (this.metricQueue.length >= this.maxBufferSize) this.flush();
  }

  queueMetricBatch(metrics: MetricDataPoint[]): void {
    this.metricQueue.push(...metrics);
    if (this.metricQueue.length >= this.maxBufferSize) this.flush();
  }

  // ──────── TRACES ────────

  queueSpan(span: TraceSpan): void {
    this.spanQueue.push(span);
    if (this.spanQueue.length >= this.maxBufferSize) this.flush();
  }

  queueSpanBatch(spans: TraceSpan[]): void {
    this.spanQueue.push(...spans);
    if (this.spanQueue.length >= this.maxBufferSize) this.flush();
  }

  // ──────── FLUSH ────────

  public flush(): void {
    if (this.logQueue.length === 0 && this.metricQueue.length === 0 && this.spanQueue.length === 0) return;

    const logs = this.logQueue;
    const metrics = this.metricQueue;
    const spans = this.spanQueue;

    this.logQueue = [];
    this.metricQueue = [];
    this.spanQueue = [];

    const runTransaction = this.db.transaction(() => {
      for (const entry of logs) {
        this.insertLogStmt.run({
          $id: entry.id,
          $level: entry.level,
          $levelLabel: entry.levelLabel,
          $time: entry.time,
          $msg: entry.msg,
          $namespace: entry.namespace || null,
          $channel: entry.channel,
          $data: JSON.stringify(entry.data),
          $traceId: entry.traceId || null,
          $spanId: entry.spanId || null,
          $source: entry.source || null,
          $instanceId: entry.instanceId || null,
          $sourceVerified: entry.sourceVerified ? 1 : 0,
        });
      }

      for (const m of metrics) {
        this.insertMetricStmt.run({
          $name: m.name,
          $description: m.description || null,
          $unit: m.unit || null,
          $type: m.type,
          $channel: m.channel,
          $timeUnixNano: m.timeUnixNano,
          $value: m.value,
          $attributes: JSON.stringify(m.attributes),
        });
      }

      for (const s of spans) {
        this.insertSpanStmt.run({
          $traceId: s.traceId,
          $spanId: s.spanId,
          $parentSpanId: s.parentSpanId || null,
          $name: s.name,
          $startTimeMs: s.startTimeMs,
          $endTimeMs: s.endTimeMs,
          $channel: s.channel,
          $attributes: JSON.stringify(s.attributes),
          $statusCode: s.status?.code ?? null,
          $statusMessage: s.status?.message ?? null,
        });
      }
    });

    runTransaction();
  }

  // ──────── QUERIES ────────

  query(opts: QueryOpts = {}): QueryResult {
    const limit = Math.min(Math.max(opts.limit || 100, 1), 10_000);
    const offset = Math.max(opts.offset || 0, 0);
    const order = opts.order === 'asc' ? 'ASC' : 'DESC';

    const conditions: string[] = [];
    const params: Record<string, any> = {};
    let useFts = false;

    if (opts.channel) {
      conditions.push('logs.channel = $channel');
      params.$channel = opts.channel;
    }
    if (opts.level !== undefined) {
      conditions.push('logs.level >= $level');
      params.$level = opts.level;
    }
    addLevelAndNamespaceConditions(conditions, params, opts.levels, opts.namespaces);
    if (opts.search) {
      const ftsQuery = buildFtsQuery(opts.search);
      if (ftsQuery) {
        useFts = true;
        conditions.push('logs_fts MATCH $ftsSearch');
        params.$ftsSearch = ftsQuery;
      }
    }
    if (opts.since !== undefined) {
      conditions.push('logs.time >= $since');
      params.$since = opts.since;
    }
    if (opts.until !== undefined) {
      conditions.push('logs.time <= $until');
      params.$until = opts.until;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const from = useFts
      ? 'logs JOIN logs_fts ON logs.rowid = logs_fts.rowid'
      : 'logs';

    const countRow = this.db.prepare(`SELECT COUNT(*) as total FROM ${from} ${where}`).get(params) as { total: number };
    const total = countRow.total;

    const rows = this.db.prepare(
      `SELECT logs.* FROM ${from} ${where} ORDER BY logs.time ${order}, logs.rowid ${order} LIMIT $limit OFFSET $offset`
    ).all({ ...params, $limit: limit, $offset: offset }) as any[];

    const logs: LogEntry[] = rows.map((row) => this.rowToLog(row));

    return { logs, count: logs.length, total, limit, offset };
  }

  queryMetrics(opts: MetricQueryOpts = {}): MetricQueryResult {
    const limit = Math.min(Math.max(opts.limit || 100, 1), 1000);
    const offset = Math.max(opts.offset || 0, 0);
    const order = opts.order === 'asc' ? 'ASC' : 'DESC';

    const conditions: string[] = [];
    const params: Record<string, any> = {};

    if (opts.channel) {
      conditions.push('channel = $channel');
      params.$channel = opts.channel;
    }
    if (opts.name) {
      conditions.push('name = $name');
      params.$name = opts.name;
    }
    if (opts.type) {
      conditions.push('type = $type');
      params.$type = opts.type;
    }
    if (opts.since !== undefined) {
      conditions.push('time_unix_nano >= $since');
      params.$since = opts.since;
    }
    if (opts.until !== undefined) {
      conditions.push('time_unix_nano <= $until');
      params.$until = opts.until;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = this.db.prepare(`SELECT COUNT(*) as total FROM metrics ${where}`).get(params) as { total: number };
    const total = countRow.total;

    const rows = this.db.prepare(
      `SELECT * FROM metrics ${where} ORDER BY time_unix_nano ${order} LIMIT $limit OFFSET $offset`
    ).all({ ...params, $limit: limit, $offset: offset }) as any[];

    const metrics: MetricDataPoint[] = rows.map((row) => ({
      name: row.name,
      description: row.description || undefined,
      unit: row.unit || undefined,
      type: row.type,
      channel: row.channel,
      timeUnixNano: row.time_unix_nano,
      value: row.value,
      attributes: JSON.parse(row.attributes),
    }));

    return { metrics, count: metrics.length, total, limit, offset };
  }

  queryTraces(opts: TraceQueryOpts = {}): TraceQueryResult {
    const limit = Math.min(Math.max(opts.limit || 100, 1), 10_000);
    const offset = Math.max(opts.offset || 0, 0);
    const order = opts.order === 'asc' ? 'ASC' : 'DESC';

    const conditions: string[] = [];
    const params: Record<string, any> = {};

    if (opts.channel) {
      conditions.push('channel = $channel');
      params.$channel = opts.channel;
    }
    if (opts.traceId) {
      conditions.push('trace_id = $traceId');
      params.$traceId = opts.traceId;
    }
    if (opts.name) {
      conditions.push('name LIKE $name');
      params.$name = `%${opts.name}%`;
    }
    if (opts.since !== undefined) {
      conditions.push('start_time_ms >= $since');
      params.$since = opts.since;
    }
    if (opts.until !== undefined) {
      conditions.push('start_time_ms <= $until');
      params.$until = opts.until;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = this.db.prepare(`SELECT COUNT(*) as total FROM traces ${where}`).get(params) as { total: number };
    const total = countRow.total;

    const rows = this.db.prepare(
      `SELECT * FROM traces ${where} ORDER BY start_time_ms ${order} LIMIT $limit OFFSET $offset`
    ).all({ ...params, $limit: limit, $offset: offset }) as any[];

    const spans: TraceSpan[] = rows.map((row) => ({
      traceId: row.trace_id,
      spanId: row.span_id,
      parentSpanId: row.parent_span_id || undefined,
      name: row.name,
      startTimeMs: row.start_time_ms,
      endTimeMs: row.end_time_ms,
      channel: row.channel,
      attributes: JSON.parse(row.attributes),
      status: row.status_code !== null ? {
        code: row.status_code,
        message: row.status_message || undefined,
      } : undefined,
    }));

    return { spans, count: spans.length, total, limit, offset };
  }

  // ──────── SQL EXECUTION ────────

  executeSql(sql: string): { columns: string[]; rows: Record<string, unknown>[]; rowCount: number; executionTimeMs: number; truncated: boolean } {
    const stripped = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const firstWord = stripped.split(/\s+/)[0]?.toUpperCase();

    if (firstWord !== 'SELECT' && firstWord !== 'WITH') {
      throw new Error('Only SELECT queries are allowed');
    }

    // Reject multi-statement payloads (single trailing semicolon is OK).
    const withoutTrailing = stripped.replace(/;\s*$/, '');
    if (withoutTrailing.includes(';')) {
      throw new Error('Only a single statement is allowed');
    }

    // Deny-list of dangerous constructs reachable through SELECT/WITH
    // (ATTACH, PRAGMA, load_extension, and pragma_* table-valued functions
    // can read sqlite_master paths or attach arbitrary DB files on disk).
    if (/\b(ATTACH|DETACH|PRAGMA|LOAD_EXTENSION|SQLITE_MASTER|pragma_[a-z_]+)\b/i.test(withoutTrailing)) {
      throw new Error('Query contains disallowed keyword');
    }

    const finalSql = /\bLIMIT\b/i.test(withoutTrailing)
      ? withoutTrailing
      : `${withoutTrailing} LIMIT 10000`;

    const start = performance.now();
    const rows = this.readonlyDb.prepare(finalSql).all() as Record<string, unknown>[];
    const executionTimeMs = Math.round((performance.now() - start) * 100) / 100;

    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    // Cap response size to ~10MB to protect memory / event loop.
    const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
    let truncated = false;
    let totalBytes = 0;
    const capped: Record<string, unknown>[] = [];
    for (const row of rows) {
      totalBytes += JSON.stringify(row).length;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        truncated = true;
        break;
      }
      capped.push(row);
    }

    return { columns, rows: capped, rowCount: capped.length, executionTimeMs, truncated };
  }

  getCounts(channel?: string): {
    levels: Record<string, number>;
    namespaces: Record<string, number>;
    total: number;
  } {
    const where = channel ? 'WHERE channel = $channel' : '';
    const params = channel ? { $channel: channel } : {};

    const levelRows = this.db.prepare(
      `SELECT level_label, COUNT(*) as count FROM logs ${where} GROUP BY level_label`
    ).all(params as Record<string, string>) as { level_label: string; count: number }[];

    const nsRows = this.db.prepare(
      `SELECT COALESCE(namespace, '(none)') as ns, COUNT(*) as count FROM logs ${where} GROUP BY ns`
    ).all(params as Record<string, string>) as { ns: string; count: number }[];

    const levels: Record<string, number> = {};
    let total = 0;
    for (const row of levelRows) {
      levels[row.level_label] = row.count;
      total += row.count;
    }

    const namespaces: Record<string, number> = {};
    for (const row of nsRows) {
      namespaces[row.ns] = row.count;
    }

    return { levels, namespaces, total };
  }

  // ──────── LOOKUPS ────────

  /**
   * Get logs after a given ID using cursor-based pagination.
   * Uses the rowid to efficiently find logs inserted after the given ID.
   * If the cursor row is gone (pruned by retention), every surviving row is
   * newer than it, so the scan starts from the oldest remaining log instead of
   * comparing against NULL (which would match nothing and stall pollers forever).
   */
  queryAfterId(afterId: string, channel?: string, limit = 500, levels?: string[], namespaces?: string[]): LogEntry[] {
    const conditions = ['rowid > COALESCE((SELECT rowid FROM logs WHERE id = $afterId), 0)'];
    const params: Record<string, any> = { $afterId: afterId, $limit: limit };

    if (channel) {
      conditions.push('channel = $channel');
      params.$channel = channel;
    }
    addLevelAndNamespaceConditions(conditions, params, levels, namespaces);

    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = this.db.prepare(
      `SELECT * FROM logs ${where} ORDER BY time ASC LIMIT $limit`
    ).all(params) as any[];

    return rows.map((row) => this.rowToLog(row));
  }

  /**
   * Get logs before a given ID using cursor-based pagination (backward/older).
   * Returns logs in chronological (ASC) order for direct prepending.
   */
  queryBeforeId(beforeId: string, channel?: string, limit = 500, levels?: string[], namespaces?: string[]): { logs: LogEntry[]; hasMore: boolean } {
    const conditions = ['rowid < (SELECT rowid FROM logs WHERE id = $beforeId)'];
    const params: Record<string, any> = { $beforeId: beforeId, $limit: limit + 1 };

    if (channel) {
      conditions.push('channel = $channel');
      params.$channel = channel;
    }
    addLevelAndNamespaceConditions(conditions, params, levels, namespaces);

    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = this.db.prepare(
      `SELECT * FROM logs ${where} ORDER BY rowid DESC LIMIT $limit`
    ).all(params) as any[];

    const hasMore = rows.length > limit;
    const resultRows = hasMore ? rows.slice(0, limit) : rows;

    // Reverse to chronological order (oldest first)
    resultRows.reverse();

    const logs: LogEntry[] = resultRows.map((row) => this.rowToLog(row));

    return { logs, hasMore };
  }

  queryById(id: string): { time: number; channel: string } | null {
    const row = this.db.prepare('SELECT time, channel FROM logs WHERE id = ?').get(id) as { time: number; channel: string } | null;
    return row || null;
  }

  // ──────── COMMON ────────

  getChannels(): string[] {
    const rows = this.db.prepare('SELECT DISTINCT channel FROM logs ORDER BY channel').all() as Array<{ channel: string }>;
    return rows.map((r) => r.channel);
  }

  getStats(): DbStats {
    const totalRow = this.db.prepare('SELECT COUNT(*) as total FROM logs').get() as { total: number };

    const channelRows = this.db.prepare(`
      SELECT channel, COUNT(*) as count, MAX(time) as lastActivity
      FROM logs GROUP BY channel ORDER BY lastActivity DESC
    `).all() as Array<{ channel: string; count: number; lastActivity: number }>;

    let dbSizeBytes = 0;
    try {
      dbSizeBytes = statSync(this.config.path).size;
    } catch {
      // DB file might not exist yet
    }

    const channels: ChannelStats[] = channelRows.map((r) => ({
      name: r.channel,
      count: r.count,
      lastActivity: r.lastActivity,
    }));

    return {
      totalLogs: totalRow.total,
      dbSizeBytes,
      channels,
    };
  }

  clear(channel?: string): void {
    if (channel) {
      this.db.prepare('DELETE FROM logs WHERE channel = ?').run(channel);
      this.db.prepare('DELETE FROM metrics WHERE channel = ?').run(channel);
      this.db.prepare('DELETE FROM traces WHERE channel = ?').run(channel);
    } else {
      this.db.run('DELETE FROM logs');
      this.db.run('DELETE FROM metrics');
      this.db.run('DELETE FROM traces');
    }
  }

  deleteChannel(channel: string): void {
    const runTransaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM logs WHERE channel = ?').run(channel);
      this.db.prepare('DELETE FROM metrics WHERE channel = ?').run(channel);
      this.db.prepare('DELETE FROM traces WHERE channel = ?').run(channel);
    });
    runTransaction();
  }

  private pruneIfNeeded(): void {
    // 1. Time-based Pruning (TTL) - extremely fast index-based deletion
    if (this.config.ttlMs > 0) {
      const cutoff = Date.now() - this.config.ttlMs;
      
      this.db.prepare('DELETE FROM logs WHERE time < ?').run(cutoff);
      // metrics use unix nano
      this.db.prepare('DELETE FROM metrics WHERE time_unix_nano < ?').run(cutoff * 1_000_000);
      this.db.prepare('DELETE FROM traces WHERE start_time_ms < ?').run(cutoff);
    }

    // 2. Optimized Count-based Pruning (Memory limit)
    // Avoids SELECT COUNT(*) entirely by using rowid offset
    if (this.config.maxLogs > 0) {
      // Find the rowid of the oldest allowed log
      const logLimitResult = this.db.prepare(
        'SELECT rowid FROM logs ORDER BY rowid DESC LIMIT 1 OFFSET ?'
      ).get(this.config.maxLogs) as { rowid: number } | undefined;

      if (logLimitResult && logLimitResult.rowid) {
        this.db.prepare('DELETE FROM logs WHERE rowid <= ?').run(logLimitResult.rowid);
      }

      // Do the same for metrics and traces (assuming maxLogs applies roughly to them too)
      const metricLimitResult = this.db.prepare(
        'SELECT id FROM metrics ORDER BY id DESC LIMIT 1 OFFSET ?'
      ).get(this.config.maxLogs) as { id: number } | undefined;

      if (metricLimitResult && metricLimitResult.id) {
        this.db.prepare('DELETE FROM metrics WHERE id <= ?').run(metricLimitResult.id);
      }

      const traceLimitResult = this.db.prepare(
        'SELECT rowid FROM traces ORDER BY rowid DESC LIMIT 1 OFFSET ?'
      ).get(this.config.maxLogs) as { rowid: number } | undefined;

      if (traceLimitResult && traceLimitResult.rowid) {
        this.db.prepare('DELETE FROM traces WHERE rowid <= ?').run(traceLimitResult.rowid);
      }
    }

    // 3. Return pages freed by the deletes above back to the OS so the file
    // shrinks toward average (not peak) volume. No-op when auto_vacuum is off
    // (e.g. :memory:) or when there are no free pages to reclaim.
    if (this.config.path !== ':memory:' && (this.config.ttlMs > 0 || this.config.maxLogs > 0)) {
      this.db.run('PRAGMA incremental_vacuum');
    }
  }

  close(): void {
    console.log('[Database] Closing instance...');
    clearInterval(this.pruneTimer);
    clearInterval(this.flushTimer);
    this.flush(); // Final flush
    this.readonlyDb.close();
    this.db.close();
    console.log('[Database] Connection closed successfully');
  }
}

// Singleton
let instance: LogDatabase | null = null;

export function getDatabase(): LogDatabase {
  if (!instance) {
    instance = new LogDatabase();
  }
  return instance;
}

export function resetDatabase(): void {
  if (instance) {
    instance.close();
  }
  instance = null;
}
