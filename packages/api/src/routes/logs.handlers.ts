import type { Context } from 'hono';
import { randomBytes } from 'crypto';
import { getLogBuffer, DEFAULT_CHANNEL } from '../lib/log-buffer.js';
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

  // Check if it's a batch request
  if (body && 'logs' in body && Array.isArray(body.logs)) {
    const batchBody = body as BatchLogRequest;
    const entries = buffer.addBatch(batchBody.logs, channel);
    return c.json({ received: entries.length, channel }, 201);
  }

  // Single log
  const log = body as IncomingLog;
  buffer.add(log, channel);
  return c.json({ received: 1, channel }, 201);
}

/**
 * DELETE /api/logs - Clear logs
 * Query params:
 *   - channel: clear only specific channel (optional, default: clear all)
 */
export function clearLogs(c: Context) {
  const buffer = getLogBuffer();
  const channel = c.req.query('channel');
  buffer.clear(channel);
  return c.json({ success: true, channel: channel || 'all' });
}

/**
 * GET /api/logs - Get buffered logs (for initial load)
 * Query params:
 *   - channel: filter by specific channel (optional, default: all channels)
 */
export function getLogs(c: Context) {
  const buffer = getLogBuffer();
  const channel = c.req.query('channel');
  const logs = buffer.getAll(channel);
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
 * GET /api/generate-key - Generate a random encryption key
 * Query params:
 *   - length: key length in bytes (default: 32, min: 16, max: 64)
 */
export function generateKey(c: Context) {
  const lengthParam = c.req.query('length');
  let length = 32;

  if (lengthParam) {
    length = Math.min(64, Math.max(16, parseInt(lengthParam, 10) || 32));
  }

  const key = randomBytes(length).toString('base64url');
  return c.json({ key });
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
