import { Hono } from 'hono';
import { ingestLogs, streamLogs, clearLogs, getLogs, getChannels, generateKey } from './logs.handlers.js';

const routes = new Hono();

// Log ingestion
routes.post('/logs', ingestLogs);

// SSE stream
routes.get('/logs/stream', streamLogs);

// Get buffered logs
routes.get('/logs', getLogs);

// Clear logs
routes.delete('/logs', clearLogs);

// Get available channels
routes.get('/channels', getChannels);

// Generate encryption key
routes.get('/generate-key', generateKey);

export default routes;
