import { Hono } from 'hono';
import { getLogs, ingestLogs, clearLogs, deleteChannel, getChannels, getStats, getMetrics, getTraces, executeSql } from './logs.handlers.js';
import { ingestOtlpLogs, ingestOtlpMetrics, ingestOtlpTraces } from './otlp.handlers.js';

const router = new Hono();

// Standard API routes (under /api)
router.post('/api/logs', ingestLogs);
router.get('/api/logs', getLogs);
router.delete('/api/logs', clearLogs);
router.get('/api/channels', getChannels);
router.delete('/api/channels', deleteChannel);
router.get('/api/metrics', getMetrics);
router.get('/api/traces', getTraces);
router.get('/api/stats', getStats);
router.post('/api/sql', executeSql);

// OTLP Ingestion Routes (under /v1 per OpenTelemetry spec)
router.post('/v1/logs', ingestOtlpLogs);
router.post('/v1/metrics', ingestOtlpMetrics);
router.post('/v1/traces', ingestOtlpTraces);

export default router;
