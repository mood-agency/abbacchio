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
 *   - afterId: return only logs after this ID (for forward polling)
 *   - beforeId: return only logs before this ID (for backward/older pagination)
 *   - limit: max number of logs to return (default: 1000 for initial, 500 for cursors)
 */
export function getLogs(c: Context) {
  const buffer = getLogBuffer();
  const db = getDatabase();
  const channel = c.req.query('channel');
  const afterId = c.req.query('afterId');
  const beforeId = c.req.query('beforeId');
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 10_000) : undefined;

  const levelsParam = c.req.query('levels');
  const namespacesParam = c.req.query('namespaces');
  const levels = levelsParam ? levelsParam.split(',').filter(Boolean) : undefined;
  const namespaces = namespacesParam ? namespacesParam.split(',').filter(Boolean) : undefined;
  const hasServerFilters = !!(levels || namespaces);

  // --- Forward pagination (polling for newer logs) ---
  if (afterId) {
    // Skip in-memory buffer when server-side filters are active (buffer can't filter)
    if (!hasServerFilters) {
      const logs = buffer.getSince(afterId, channel || undefined);
      if (logs !== null) {
        return c.json({
          logs,
          count: logs.length,
          channel: channel || 'all',
        });
      }
    }
    db.flush();
    const dbLogs = db.queryAfterId(afterId, channel || undefined, limit, levels, namespaces);
    return c.json({
      logs: dbLogs,
      count: dbLogs.length,
      channel: channel || 'all',
    });
  }

  // --- Backward pagination (loading older logs on scroll-up) ---
  if (beforeId) {
    db.flush();
    const { logs, hasMore } = db.queryBeforeId(beforeId, channel || undefined, limit || 500, levels, namespaces);
    return c.json({
      logs,
      count: logs.length,
      hasMore,
      channel: channel || 'all',
    });
  }

  // --- Initial load: fetch NEWEST logs, return in chronological order ---
  db.flush();
  const result = db.query({
    channel: channel || undefined,
    order: 'desc',
    limit: limit || 1000,
    levels,
    namespaces,
  });

  // Reverse to chronological order (oldest-to-newest) for display
  result.logs.reverse();

  return c.json({
    logs: result.logs,
    count: result.count,
    total: result.total,
    channel: channel || 'all',
  });
}

/**
 * GET /api/logs/counts - Get level and namespace counts from the server
 * Query params:
 *   - channel: filter by channel (optional)
 */
export function getLogCounts(c: Context) {
  const db = getDatabase();
  const channel = c.req.query('channel');
  db.flush();
  const counts = db.getCounts(channel || undefined);
  return c.json(counts);
}

/**
 * DELETE /api/channels - Delete a channel and all its data
 * Query params:
 *   - name: channel name to delete (required)
 */
export function deleteChannel(c: Context) {
  const name = c.req.query('name');
  if (!name) {
    return c.json({ error: 'Missing "name" query parameter' }, 400);
  }
  if (name === DEFAULT_CHANNEL) {
    return c.json({ error: 'Cannot delete the default channel' }, 400);
  }

  const buffer = getLogBuffer();
  const db = getDatabase();

  buffer.deleteChannel(name);
  db.deleteChannel(name);

  return c.json({ success: true, channel: name });
}

/**
 * GET /api/channels - Get list of available channels
 */
export function getChannels(c: Context) {
  const buffer = getLogBuffer();
  const db = getDatabase();

  // Merge channels from in-memory buffer and SQLite
  const bufferChannels = buffer.getChannels();
  const dbChannels = db.getChannels();
  const merged = [...new Set([...bufferChannels, ...dbChannels])].sort();

  return c.json({
    channels: merged,
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
    if (process.env.NODE_ENV === 'production') {
      const safeMessages = new Set([
        'Only SELECT queries are allowed',
        'Only a single statement is allowed',
        'Query contains disallowed keyword',
      ]);
      const safe = safeMessages.has(message);
      return c.json({ error: safe ? message : 'Query execution failed' }, 400);
    }
    return c.json({ error: message }, 400);
  }
}
