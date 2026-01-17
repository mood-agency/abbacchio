# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Abbacchio** is a real-time log viewer with HTTP ingestion supporting multiple logging libraries (Pino, Winston, Bunyan, Console). This is the `@abbacchio/api` package - the Node.js backend server.

## Monorepo Structure

This package is part of a pnpm workspace:
- `packages/api` - Backend server (Hono framework) - **you are here**
- `packages/transport` - Client libraries for various loggers
- `packages/dashboard` - React frontend (Vite + Tailwind)

## Common Commands

```bash
# From monorepo root
pnpm dev              # Run API + Dashboard with hot reload
pnpm build            # Build all packages
pnpm start            # Start production server

# From this package (packages/api)
npm run dev           # tsx watch on port 4000
npm run build         # tsc to dist/
npm run test          # vitest single run
npm run test:watch    # vitest watch mode
npm run test:coverage # vitest with coverage
```

## Architecture

### Key Design Decisions

1. **No Server-Side Log Storage**: The API only streams logs via SSE. All persistence happens client-side in SQLite (browser). The LogBuffer is an EventEmitter that emits logs to connected clients.

2. **Channel-Based Isolation**: SSE requires a `channel` query parameter. Logs are namespaced by channel to support multi-app scenarios.

3. **End-to-End Encryption**: Server accepts `{ encrypted: "base64-string" }` payloads and passes them through unchanged. Decryption happens only in the dashboard with user-provided keys.

### Core Components

| File | Purpose |
|------|---------|
| `src/server.ts` | Entry point, Hono app setup, CORS, optional API key auth |
| `src/lib/log-buffer.ts` | EventEmitter for log streaming, normalizes Pino/Winston/Bunyan formats |
| `src/routes/logs.handlers.ts` | Route handlers: ingest, stream (SSE), channels, generate-key |
| `src/types.ts` | LogEntry, IncomingLog, LOG_LEVELS definitions |

### Data Flow

```
Logger → Transport → POST /api/logs → LogBuffer.addLog() → emit('log')
                                                              ↓
Dashboard ← SSE /api/logs/stream?channel=X ← EventEmitter listener
```

### Log Entry Structure

```typescript
{
  id: string;           // nanoid
  level: number;        // 10-60 (trace to fatal)
  levelLabel: string;   // trace|debug|info|warn|error|fatal
  time: number;         // Unix timestamp ms
  msg: string;
  namespace?: string;
  channel: string;
  data: Record<string, any>;
  encrypted?: boolean;
  encryptedData?: string;
}
```

## Testing

Tests are in `tests/` using Vitest:
- `tests/setup.ts` resets LogBuffer between tests
- `tests/helpers/` contains test app factory and SSE event collector
- Pattern: use `createTestApp()` for isolated instances

Run a single test file:
```bash
npm run test -- tests/logs-ingest.test.ts
```

## Environment Variables

```
PORT=4000
API_KEY=<optional>     # Enables X-API-KEY header auth
CORS_ORIGIN=*
```
