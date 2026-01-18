import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { randomBytes } from 'crypto';
import { getLogBuffer, DEFAULT_CHANNEL } from '../lib/log-buffer.js';
import { getConnectionManager } from '../lib/connection-manager.js';
import { getValidatedBody } from '../middleware/validator.js';
import type { IncomingLog, BatchLogRequest, LogEntry } from '../types.js';

/** Maximum messages to queue per connection before dropping */
const MAX_QUEUE_SIZE = parseInt(process.env.MAX_QUEUE_SIZE || '1000', 10);

/** Heartbeat interval in milliseconds */
const HEARTBEAT_INTERVAL = 15000;

/** Connection timeout check interval */
const TIMEOUT_CHECK_INTERVAL = 60000;

/** Map of connection IDs to their abort controllers for graceful disconnect */
const connectionAbortControllers = new Map<string, AbortController>();

/**
 * Signal a connection to close gracefully
 */
export function signalDisconnect(connectionId: string): boolean {
  const controller = connectionAbortControllers.get(connectionId);
  if (controller) {
    controller.abort();
    connectionAbortControllers.delete(connectionId);
    return true;
  }
  return false;
}

/**
 * Signal all connections for a channel to close
 */
export function signalChannelDisconnect(channel: string): number {
  const connectionManager = getConnectionManager();
  const connections = connectionManager.getByChannel(channel);
  let closed = 0;
  for (const conn of connections) {
    if (signalDisconnect(conn.id)) {
      closed++;
    }
  }
  return closed;
}

/**
 * Extract channel from request (header or query param)
 */
function getChannel(c: Context): string {
  return c.req.header('X-Channel') || c.req.query('channel') || DEFAULT_CHANNEL;
}

// SECURITY: Only trust proxy headers when explicitly enabled
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

/**
 * Get client IP from context
 * SECURITY: Only trusts proxy headers when TRUST_PROXY is enabled
 */
function getClientIp(c: Context): string {
  if (TRUST_PROXY) {
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    const realIp = c.req.header('x-real-ip');
    if (realIp) {
      return realIp;
    }
  }
  // Fallback to a simple identifier when proxy is not trusted
  return 'direct-client';
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
 * GET /api/logs/stream - SSE endpoint for real-time logs
 * Query params:
 *   - channel: REQUIRED - filter by specific channel (security: no channel = no logs)
 */
export async function streamLogs(c: Context) {
  const buffer = getLogBuffer();
  const connectionManager = getConnectionManager();
  const channel = c.req.query('channel');

  // Security: require channel parameter - no channel means no logs
  if (!channel) {
    return c.json({ error: 'Channel parameter is required' }, 400);
  }

  // Check connection limit
  if (!connectionManager.canAcceptConnection()) {
    console.warn(
      `[SSE] Connection rejected: Maximum connections reached (${connectionManager.size}/${connectionManager.maxConnections})`,
      { channel }
    );
    return c.json(
      { error: 'Service Unavailable', message: 'Maximum connections reached' },
      503
    );
  }

  const clientIp = getClientIp(c);
  const connectionId = connectionManager.register(channel, clientIp);

  if (!connectionId) {
    const currentIpConnections = connectionManager.getConnectionCountByIp(clientIp);
    console.warn(
      `[SSE] Connection rejected: IP limit reached for ${clientIp} (${currentIpConnections} connections)`,
      { channel, clientIp }
    );
    return c.json(
      {
        error: 'Service Unavailable',
        message: 'Too many connections from your IP. Please close some channels and try again.',
      },
      503
    );
  }

  return streamSSE(c, async (stream) => {
    // Message queue for backpressure handling
    const messageQueue: Array<{ event: string; data: string; id?: string }> = [];
    let isWriting = false;
    let isClosed = false;

    // Create abort controller for graceful disconnect
    const abortController = new AbortController();
    connectionAbortControllers.set(connectionId, abortController);

    /**
     * Process queued messages
     */
    const processQueue = async () => {
      if (isWriting || isClosed) return;
      isWriting = true;

      while (messageQueue.length > 0 && !isClosed) {
        const msg = messageQueue.shift()!;
        try {
          await stream.writeSSE(msg);
          connectionManager.recordBytesSent(connectionId, msg.data.length);
        } catch {
          // Stream closed
          isClosed = true;
          break;
        }
      }

      isWriting = false;
    };

    /**
     * Queue a message with backpressure handling
     */
    const queueMessage = (event: string, data: string, id?: string) => {
      if (isClosed) return;

      // Drop oldest messages if queue is full
      if (messageQueue.length >= MAX_QUEUE_SIZE) {
        messageQueue.shift();
        connectionManager.recordDroppedMessage(connectionId);
      }

      messageQueue.push({ event, data, id });
      processQueue();
    };

    // Send initial ping immediately to confirm connection is open
    queueMessage('ping', 'connected', 'init');

    // Send buffered logs first (always empty in streaming-only mode)
    const existingLogs = buffer.getAll(channel);
    if (existingLogs.length > 0) {
      queueMessage('batch', JSON.stringify(existingLogs), 'initial');
    }

    // Send available channels
    queueMessage('channels', JSON.stringify(buffer.getChannels()), 'channels');

    // Subscribe to new logs (receives pre-serialized JSON)
    const onLog = (entry: LogEntry, serialized: string) => {
      // Skip entries from other channels
      if (entry.channel !== channel) return;
      queueMessage('log', serialized, entry.id);
    };

    // Subscribe to batch logs (receives pre-serialized JSON)
    const onBatch = (entries: LogEntry[], serialized: string) => {
      // Filter to only include entries from this channel
      const filtered = entries.filter(e => e.channel === channel);
      if (filtered.length === 0) return;

      // If all entries match, use pre-serialized string
      if (filtered.length === entries.length) {
        queueMessage('batch', serialized, filtered[0]?.id || 'batch');
      } else {
        // Otherwise, serialize the filtered subset
        queueMessage('batch', JSON.stringify(filtered), filtered[0]?.id || 'batch');
      }
    };

    const onChannelAdded = (newChannel: string) => {
      queueMessage('channel:added', newChannel, `channel-${newChannel}`);
    };

    // Register event handlers
    buffer.on('log', onLog);
    buffer.on('batch', onBatch);
    buffer.on('channel:added', onChannelAdded);

    // Cleanup function
    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;

      buffer.off('log', onLog);
      buffer.off('batch', onBatch);
      buffer.off('channel:added', onChannelAdded);
      connectionManager.unregister(connectionId);
      connectionAbortControllers.delete(connectionId);
      messageQueue.length = 0;
    };

    // Register cleanup on abort (from client or signal)
    stream.onAbort(cleanup);
    abortController.signal.addEventListener('abort', cleanup);

    // Heartbeat and timeout check loop
    while (!isClosed) {
      await new Promise(resolve => setTimeout(resolve, HEARTBEAT_INTERVAL));

      if (isClosed) break;

      // Check if connection is stale
      if (connectionManager.isStale(connectionId)) {
        cleanup();
        break;
      }

      // Send heartbeat ping
      try {
        await stream.writeSSE({
          event: 'ping',
          data: 'ping',
        });
        connectionManager.touch(connectionId);
      } catch {
        // Stream closed
        cleanup();
        break;
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

/**
 * GET /api/stats - Get server statistics
 */
export function getStats(c: Context) {
  const buffer = getLogBuffer();
  const connectionManager = getConnectionManager();

  return c.json({
    connections: connectionManager.getStats(),
    channels: buffer.getStats(),
  });
}

/**
 * POST /api/logs/disconnect - Signal SSE connections to close
 * Query params:
 *   - channel: close all connections for this channel (required)
 */
export function disconnectChannel(c: Context) {
  const channel = c.req.query('channel');

  if (!channel) {
    return c.json({ error: 'Channel parameter is required' }, 400);
  }

  const closedCount = signalChannelDisconnect(channel);

  return c.json({
    channel,
    closedConnections: closedCount,
  });
}
