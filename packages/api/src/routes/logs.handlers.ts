import type { Context } from 'hono';
import { getLogBuffer, DEFAULT_CHANNEL } from '../lib/log-buffer.js';
import { getMetricBuffer } from '../lib/metric-buffer.js';
import { getTraceBuffer } from '../lib/trace-buffer.js';
import { getDatabase } from '../lib/database.js';
import { getValidatedBody } from '../middleware/validator.js';
import type { IncomingLog, BatchLogRequest } from '../types.js';

/**
 * Extract channel from request (header or query param)
 */
function getChannel(c: Context): string {
  return c.req.header('X-Channel') || c.req.query('channel') || DEFAULT_CHANNEL;
}

/**
 * POST /api/logs - Ingest logs (single or batch)
 * Channel can be specified via X-Channel header or ?channel query param
 */
export async function ingestLogs(c: Context) {
  const buffer = getLogBuffer();
  const channel = getChannel(c);

  // Use pre-validated body if available (from validator middleware)
  let body = getValidatedBody<BatchLogRequest | IncomingLog>(c);
  if (!body) {
    body = await c.req.json();
  }

  const db = getDatabase();

  // Check if it's a batch request
  if (body && 'logs' in body && Array.isArray(body.logs)) {
    const batchBody = body as BatchLogRequest;
    const entries = buffer.addBatch(batchBody.logs, channel);
    db.insertBatch(entries);
    return c.json({ received: entries.length, channel }, 201);
  }

  // Single log
  const log = body as IncomingLog;
  const entry = buffer.add(log, channel);
  db.insert(entry);
  return c.json({ received: 1, channel }, 201);
}

/**
 * DELETE /api/logs - Clear logs
 * Query params:
 *   - channel: clear only specific channel (optional, default: clear all)
 */
export function clearLogs(c: Context) {
  const buffer = getLogBuffer();
  const db = getDatabase();
  const channel = c.req.query('channel');
  buffer.clear(channel);
  db.clear(channel || undefined);
  return c.json({ success: true, channel: channel || 'all' });
}

/**
 * GET /api/logs - Get buffered logs
 * Query params:
 *   - channel: filter by specific channel (optional, default: all channels)
 *   - afterId: return only logs after this ID (for polling)
 */
export function getLogs(c: Context) {
  const buffer = getLogBuffer();
  const channel = c.req.query('channel');
  const afterId = c.req.query('afterId');

  const logs = afterId
    ? buffer.getSince(afterId, channel || undefined)
    : buffer.getAll(channel || undefined);

  return c.json({
    logs,
    count: logs.length,
    channel: channel || 'all',
  });
}

/**
 * GET /api/channels - Get list of available channels
 */
export function getChannels(c: Context) {
  const buffer = getLogBuffer();
  return c.json({
    channels: buffer.getChannels(),
  });
}

/**
 * GET /api/metrics - Get buffered metrics
 * Query params:
 *   - channel: filter by specific channel (optional, default: 'default')
 */
export function getMetrics(c: Context) {
  const metricBuffer = getMetricBuffer();
  const channel = c.req.query('channel') || DEFAULT_CHANNEL;
  const metrics = metricBuffer.getAll(channel);
  return c.json({
    metrics,
    count: metrics.length,
    channel,
  });
}

/**
 * GET /api/traces - Get buffered traces
 * Query params:
 *   - channel: filter by specific channel (optional, default: 'default')
 */
export function getTraces(c: Context) {
  const traceBuffer = getTraceBuffer();
  const channel = c.req.query('channel') || DEFAULT_CHANNEL;
  const traces = traceBuffer.getAll(channel);
  return c.json({
    traces,
    count: traces.length,
    channel,
  });
}

/**
 * GET /api/stats - Get server statistics
 */
export function getStats(c: Context) {
  const buffer = getLogBuffer();

  return c.json({
    channels: buffer.getStats(),
  });
}

/**
 * POST /api/sql - Execute SQL query against the database
 */
export async function executeSql(c: Context) {
  const db = getDatabase();

  try {
    const body = await c.req.json();
    const sql = body?.sql;

    if (!sql || typeof sql !== 'string') {
      return c.json({ error: 'Missing "sql" field in request body' }, 400);
    }

    const result = db.executeSql(sql);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
}
