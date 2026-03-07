#!/usr/bin/env node
/**
 * Abbacchio MCP Server
 *
 * Enables Claude Code to search and analyze logs, metrics, and traces stored by Abbacchio.
 * Reads from SQLite database (default ~/.abbacchio/logs.db or SQLITE_PATH).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';

// Database path
const DEFAULT_DB_PATH = join(homedir(), '.abbacchio', 'logs.db');
const DB_PATH = process.env.SQLITE_PATH || DEFAULT_DB_PATH;

// Types
interface LogEntry {
  id: string;
  level: number;
  levelLabel: string;
  time: number;
  msg: string;
  namespace: string | null;
  channel: string;
  data: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
}

interface SpanEntry {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeMs: number;
  endTimeMs: number;
  channel: string;
  attributes: Record<string, unknown>;
  statusCode?: number;
  statusMessage?: string;
}

interface MetricEntry {
  name: string;
  description?: string;
  unit?: string;
  type: string;
  channel: string;
  timeUnixNano: number;
  value: number;
  attributes: Record<string, unknown>;
}

// Database helper
function getDatabase(): Database.Database | null {
  if (!existsSync(DB_PATH)) {
    return null;
  }
  return new Database(DB_PATH, { readonly: true });
}

function rowToLogEntry(row: any): LogEntry {
  return {
    id: row.id,
    level: row.level,
    levelLabel: row.level_label,
    time: row.time,
    msg: row.msg,
    namespace: row.namespace,
    channel: row.channel,
    data: JSON.parse(row.data || '{}'),
    traceId: row.trace_id || undefined,
    spanId: row.span_id || undefined,
  };
}

function rowToSpanEntry(row: any): SpanEntry {
  return {
    traceId: row.trace_id,
    spanId: row.span_id,
    parentSpanId: row.parent_span_id || undefined,
    name: row.name,
    startTimeMs: Math.floor(Number(BigInt(String(row.start_time_unix_nano || '0')) / 1_000_000n)),
    endTimeMs: Math.floor(Number(BigInt(String(row.end_time_unix_nano || '0')) / 1_000_000n)),
    channel: row.channel,
    attributes: JSON.parse(row.attributes || '{}'),
    statusCode: row.status_code !== null ? row.status_code : undefined,
    statusMessage: row.status_message || undefined,
  };
}

function rowToMetricEntry(row: any): MetricEntry {
  return {
    name: row.name,
    description: row.description || undefined,
    unit: row.unit || undefined,
    type: row.type,
    channel: row.channel,
    timeUnixNano: Number(row.time_unix_nano),
    value: row.value,
    attributes: JSON.parse(row.attributes || '{}'),
  };
}

// Tool definitions
const tools: Tool[] = [
  {
    name: 'search_logs',
    description: 'Search logs with text query and filters (including trace correlation).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for or traceId' },
        channel: { type: 'string' },
        level: { type: 'string', enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] },
        traceId: { type: 'string', description: 'Filter by specific traceId' },
        limit: { type: 'number', default: 50 },
      },
    },
  },
  {
    name: 'get_trace',
    description: 'Get all spans and logs associated with a specific traceId. Use this for root-cause analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        traceId: { type: 'string', description: 'The hex string traceId' },
      },
      required: ['traceId'],
    },
  },
  {
    name: 'search_spans',
    description: 'Search for spans (traces) by name, channel, or status.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Span name (e.g. HTTP GET /users)' },
        channel: { type: 'string' },
        errorOnly: { type: 'boolean', description: 'Only return spans with error status' },
        limit: { type: 'number', default: 50 },
      },
    },
  },
  {
    name: 'list_metrics',
    description: 'List available metric names and their types.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string' },
      },
    },
  },
  {
    name: 'get_metric_data',
    description: 'Get time-series data for a specific metric.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Metric name' },
        channel: { type: 'string' },
        limit: { type: 'number', default: 100 },
      },
      required: ['name'],
    },
  },
  {
    name: 'query_sql',
    description: 'Execute arbitrary read-only SQL queries on the Abbacchio database. Use this for advanced correlation or reporting.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'The SQL SELECT statement to execute' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'get_channels',
    description: 'List all available log/trace/metric channels.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'analyze_error',
    description: 'Search for logs related to an error message and provide context.',
    inputSchema: {
      type: 'object',
      properties: {
        error: { type: 'string' },
        channel: { type: 'string' },
      },
      required: ['error'],
    },
  },
];

// Handlers
function searchLogs(params: any): LogEntry[] {
  const db = getDatabase();
  if (!db) return [];
  try {
    let sql = 'SELECT * FROM logs WHERE 1=1';
    const sqlParams: any[] = [];

    if (params.channel) { sql += ' AND channel = ?'; sqlParams.push(params.channel); }
    if (params.traceId) { sql += ' AND trace_id = ?'; sqlParams.push(params.traceId); }
    if (params.level) {
      const levelMap: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
      sql += ' AND level >= ?'; sqlParams.push(levelMap[params.level] || 30);
    }
    if (params.query) {
      if (params.query.length > 16 && /^[0-9a-fA-F]+$/.test(params.query)) {
        sql += ' AND (trace_id = ? OR msg LIKE ?)';
        sqlParams.push(params.query, `%${params.query}%`);
      } else {
        sql += ' AND (msg LIKE ? OR data LIKE ?)';
        sqlParams.push(`%${params.query}%`, `%${params.query}%`);
      }
    }

    sql += ' ORDER BY time DESC LIMIT ?';
    sqlParams.push(params.limit || 50);

    return (db.prepare(sql).all(...sqlParams) as any[]).map(rowToLogEntry);
  } finally { db.close(); }
}

function getTrace(traceId: string): { spans: SpanEntry[]; logs: LogEntry[] } {
  const db = getDatabase();
  if (!db) return { spans: [], logs: [] };
  try {
    const spans = (db.prepare('SELECT * FROM traces WHERE trace_id = ? ORDER BY start_time_unix_nano').all(traceId) as any[]).map(rowToSpanEntry);
    const logs = (db.prepare('SELECT * FROM logs WHERE trace_id = ? ORDER BY time').all(traceId) as any[]).map(rowToLogEntry);
    return { spans, logs };
  } finally { db.close(); }
}

function searchSpans(params: any): SpanEntry[] {
  const db = getDatabase();
  if (!db) return [];
  try {
    let sql = 'SELECT * FROM traces WHERE 1=1';
    const sqlParams: any[] = [];
    if (params.name) { sql += ' AND name LIKE ?'; sqlParams.push(`%${params.name}%`); }
    if (params.channel) { sql += ' AND channel = ?'; sqlParams.push(params.channel); }
    if (params.errorOnly) { sql += ' AND status_code = 2'; } // 2 = Error in OTLP

    sql += ' ORDER BY start_time_unix_nano DESC LIMIT ?';
    sqlParams.push(params.limit || 50);
    return (db.prepare(sql).all(...sqlParams) as any[]).map(rowToSpanEntry);
  } finally { db.close(); }
}

function listMetrics(channel?: string): any[] {
  const db = getDatabase();
  if (!db) return [];
  try {
    let sql = 'SELECT DISTINCT name, type, unit, channel FROM metrics';
    if (channel) return db.prepare(sql + ' WHERE channel = ?').all(channel);
    return db.prepare(sql).all();
  } finally { db.close(); }
}

function getMetricData(name: string, channel?: string, limit = 100): MetricEntry[] {
  const db = getDatabase();
  if (!db) return [];
  try {
    let sql = 'SELECT * FROM metrics WHERE name = ?';
    const params: any[] = [name];
    if (channel) { sql += ' AND channel = ?'; params.push(channel); }
    sql += ' ORDER BY time_unix_nano DESC LIMIT ?';
    params.push(limit);
    return (db.prepare(sql).all(...params) as any[]).map(rowToMetricEntry);
  } finally { db.close(); }
}

function querySql(sql: string): any[] {
  const db = getDatabase();
  if (!db) return [];
  try {
    // Basic safety check for write operations even if opened as readonly
    const upperSql = sql.trim().toUpperCase();
    if (!upperSql.startsWith('SELECT') && !upperSql.startsWith('WITH') && !upperSql.startsWith('PRAGMA')) {
      throw new Error('Only read-only queries (SELECT, WITH, PRAGMA) are allowed.');
    }
    return db.prepare(sql).all();
  } finally { db.close(); }
}

function getChannels(): any[] {
  const db = getDatabase();
  if (!db) return [];
  try {
    const logs = db.prepare('SELECT DISTINCT channel FROM logs').all() as any[];
    const traces = db.prepare('SELECT DISTINCT channel FROM traces').all() as any[];
    const metrics = db.prepare('SELECT DISTINCT channel FROM metrics').all() as any[];
    const all = new Set([...logs, ...traces, ...metrics].map(r => r.channel));
    return Array.from(all).map(channel => ({ channel }));
  } finally { db.close(); }
}

function analyzeError(error: string, channel?: string): any {
  const keywords = error.split(/[\s\n:,()[\]{}]+/).filter(w => w.length > 3).slice(0, 5);
  const logs: LogEntry[] = [];
  for (const kw of keywords) {
    logs.push(...searchLogs({ query: kw, channel, limit: 10 }));
  }
  const seen = new Set();
  const dedupedLogs = logs.filter(l => seen.has(l.id) ? false : seen.add(l.id)).sort((a, b) => b.time - a.time);
  return { relatedLogs: dedupedLogs.slice(0, 20), summary: `Found ${dedupedLogs.length} logs for keywords ${keywords.join(', ')}` };
}

// Server setup
const server = new Server({ name: 'abbacchio-otlp', version: '0.2.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (!existsSync(DB_PATH)) {
    return { content: [{ type: 'text', text: `Database not found at ${DB_PATH}.` }] };
  }

  let result: any;
  try {
    switch (name) {
      case 'search_logs': result = searchLogs(args); break;
      case 'get_trace': result = getTrace((args as any).traceId); break;
      case 'search_spans': result = searchSpans(args); break;
      case 'list_metrics': result = listMetrics((args as any).channel); break;
      case 'get_metric_data': result = getMetricData((args as any).name, (args as any).channel, (args as any).limit); break;
      case 'query_sql': result = querySql((args as any).sql); break;
      case 'get_channels': result = getChannels(); break;
      case 'analyze_error': result = analyzeError((args as any).error, (args as any).channel); break;
      default: return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: `Error executing ${name}: ${err.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Abbacchio OTLP MCP Server started');
  console.error(`Using database: ${DB_PATH}`);
}

main().catch(err => { console.error(err); process.exit(1); });
