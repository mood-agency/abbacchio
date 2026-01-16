import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { randomBytes } from 'crypto';
import { getLogBuffer, DEFAULT_CHANNEL } from '../lib/log-buffer.js';
import type { IncomingLog, BatchLogRequest, LogEntry } from '../types.js';

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
  const body = await c.req.json();
  const channel = getChannel(c);

  // Debug: print raw request payload
  console.log('[DEBUG] Raw request payload:', JSON.stringify(body, null, 2));

  // Check if it's a batch request
  if (body.logs && Array.isArray(body.logs)) {
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
 * GET /api/logs/stream - SSE endpoint for real-time logs
 * Query params:
 *   - channel: filter by specific channel (optional, default: all channels)
 */
export async function streamLogs(c: Context) {
  const buffer = getLogBuffer();
  const channel = c.req.query('channel'); // undefined = all channels

  return streamSSE(c, async (stream) => {
    // Send buffered logs first
    const existingLogs = buffer.getAll(channel);
    if (existingLogs.length > 0) {
      await stream.writeSSE({
        event: 'batch',
        data: JSON.stringify(existingLogs),
        id: 'initial',
      });
    }

    // Send available channels
    await stream.writeSSE({
      event: 'channels',
      data: JSON.stringify(buffer.getChannels()),
      id: 'channels',
    });

    // Subscribe to new logs
    const onLog = async (entry: LogEntry) => {
      // If filtering by channel, skip entries from other channels
      if (channel && entry.channel !== channel) return;

      try {
        await stream.writeSSE({
          event: 'log',
          data: JSON.stringify(entry),
          id: entry.id,
        });
      } catch {
        // Stream closed, ignore
      }
    };

    const onBatch = async (entries: LogEntry[]) => {
      // If filtering by channel, filter the batch
      const filtered = channel
        ? entries.filter(e => e.channel === channel)
        : entries;

      if (filtered.length === 0) return;

      try {
        await stream.writeSSE({
          event: 'batch',
          data: JSON.stringify(filtered),
          id: filtered[0]?.id || 'batch',
        });
      } catch {
        // Stream closed, ignore
      }
    };

    const onChannelAdded = async (newChannel: string) => {
      try {
        await stream.writeSSE({
          event: 'channel:added',
          data: newChannel,
          id: `channel-${newChannel}`,
        });
      } catch {
        // Stream closed, ignore
      }
    };

    buffer.on('log', onLog);
    buffer.on('batch', onBatch);
    buffer.on('channel:added', onChannelAdded);

    // Cleanup on abort
    stream.onAbort(() => {
      buffer.off('log', onLog);
      buffer.off('batch', onBatch);
      buffer.off('channel:added', onChannelAdded);
    });

    // Keep connection alive with ping
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 15000));
      try {
        await stream.writeSSE({
          event: 'ping',
          data: 'ping',
        });
      } catch {
        break; // Stream closed
      }
    }
  });
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
 * GET /api/logs - Get buffered logs (for initial load without SSE)
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
