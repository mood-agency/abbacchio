import type { Context } from 'hono';
import { getLogBuffer, DEFAULT_CHANNEL } from '../lib/log-buffer.js';
import { parseOtlpLogs, parseOtlpMetrics, parseOtlpTraces } from '../lib/otlp-parser.js';
import { getMetricBuffer } from '../lib/metric-buffer.js';
import { getTraceBuffer } from '../lib/trace-buffer.js';
import { getDatabase } from '../lib/database.js';

/**
 * Extract default channel from request (header or query param)
 * OTLP specific `service.name` resource attribute will override this.
 */
function getDefaultChannel(c: Context): string {
    return c.req.header('X-Channel') || c.req.query('channel') || DEFAULT_CHANNEL;
}

/**
 * POST /v1/logs - HTTP JSON OTLP Log Receiver
 */
export async function ingestOtlpLogs(c: Context) {
    const buffer = getLogBuffer();
    const defaultChannel = getDefaultChannel(c);

    try {
        const body = await c.req.json();
        const incomingLogs = parseOtlpLogs(body, defaultChannel);

        if (incomingLogs.length > 0) {
            const entries = buffer.addBatch(incomingLogs, defaultChannel);
            getDatabase().insertBatch(entries);
        }

        // OTLP expects an empty JSON response on success
        return c.json({}, 200);
    } catch (err) {
        console.error('[OTLP logs] Failed to parse request:', err instanceof Error ? err.message : 'Unknown error');
        return c.json({ error: 'Invalid OTLP JSON' }, 400);
    }
}

/**
 * POST /v1/metrics - HTTP JSON OTLP Metric Receiver
 */
export async function ingestOtlpMetrics(c: Context) {
    const defaultChannel = getDefaultChannel(c);
    const metricBuffer = getMetricBuffer();

    try {
        const body = await c.req.json();
        const dataPoints = parseOtlpMetrics(body, defaultChannel);

        if (dataPoints.length > 0) {
            metricBuffer.addBatch(dataPoints);
            getDatabase().queueMetricBatch(dataPoints);
        }

        return c.json({}, 200);
    } catch (err) {
        console.error('[OTLP metrics] Failed to parse request:', err instanceof Error ? err.message : 'Unknown error');
        return c.json({ error: 'Invalid OTLP JSON' }, 400);
    }
}

/**
 * POST /v1/traces - HTTP JSON OTLP Trace Receiver
 */
export async function ingestOtlpTraces(c: Context) {
    const defaultChannel = getDefaultChannel(c);
    const traceBuffer = getTraceBuffer();

    try {
        const body = await c.req.json();
        const spans = parseOtlpTraces(body, defaultChannel);

        if (spans.length > 0) {
            traceBuffer.addBatch(spans);
            getDatabase().queueSpanBatch(spans);
        }

        return c.json({}, 200);
    } catch (err) {
        console.error('[OTLP traces] Failed to parse request:', err instanceof Error ? err.message : 'Unknown error');
        return c.json({ error: 'Invalid OTLP JSON' }, 400);
    }
}
