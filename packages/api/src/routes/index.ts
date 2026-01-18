import { Hono } from 'hono';
import { ingestLogs, streamLogs, clearLogs, getLogs, getChannels, generateKey, getStats, disconnectChannel } from './logs.handlers.js';

const routes = new Hono();

// Log ingestion
routes.post('/logs', ingestLogs);

// SSE stream
routes.get('/logs/stream', streamLogs);

// Disconnect SSE stream
routes.post('/logs/disconnect', disconnectChannel);

// Get buffered logs
routes.get('/logs', getLogs);

// Clear logs
routes.delete('/logs', clearLogs);

// Get available channels
routes.get('/channels', getChannels);

// Generate encryption key
routes.get('/generate-key', generateKey);

// Server statistics
routes.get('/stats', getStats);

export default routes;
