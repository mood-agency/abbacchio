import { Hono } from 'hono';
import { ingestLogs, clearLogs, getLogs, getChannels, generateKey, getStats } from './logs.handlers.js';
import { getConnectionToken, refreshToken } from './centrifugo.handlers.js';

const routes = new Hono();

// Log ingestion
routes.post('/logs', ingestLogs);

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

// Centrifugo token endpoints
routes.get('/centrifugo/token', getConnectionToken);
routes.post('/centrifugo/refresh', refreshToken);

export default routes;
