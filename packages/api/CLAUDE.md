# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Abbacchio** is a real-time log viewer with HTTP ingestion supporting multiple logging libraries (Pino, Winston, Bunyan, Console). This is the `@abbacchio/api` package - the Bun-based backend server with SQLite persistence.

## Monorepo Structure

This package is part of a pnpm workspace:
- `packages/api` - Backend server (Hono framework, Bun runtime) - **you are here**
- `packages/transport` - Client libraries for various loggers
- `packages/dashboard` - React frontend (Vite + Tailwind)

## Common Commands

```bash
# From monorepo root
pnpm dev              # Run API + Dashboard with hot reload
pnpm build            # Build all packages
pnpm start            # Start production server

# From this package (packages/api)
bun run dev           # bun --watch on port 4000
bun run build         # tsc to dist/
bun test              # bun test single run
bun test --watch      # bun test watch mode
```

## Architecture

### Key Design Decisions

1. **Dual Storage**: The API stores logs in both an in-memory ring buffer (for fast polling) and SQLite via `bun:sqlite` (for persistence and SQL queries).

2. **Channel-Based Isolation**: Logs are namespaced by channel to support multi-app scenarios.

3. **End-to-End Encryption**: Server accepts `{ encrypted: "base64-string" }` payloads and passes them through unchanged. Decryption happens only in the dashboard with user-provided keys.

### Core Components

| File | Purpose |
|------|---------|
| `src/server.ts` | Entry point, Hono app setup, CORS, optional API key auth |
| `src/lib/log-buffer.ts` | In-memory ring buffer for log polling |
| `src/lib/database.ts` | SQLite persistence layer (bun:sqlite) |
| `src/routes/logs.handlers.ts` | Route handlers: ingest, retrieve, channels, generate-key |
| `src/routes/otlp.handlers.ts` | OTLP/HTTP JSON handlers for logs, metrics, traces |
| `src/types.ts` | LogEntry, IncomingLog, LOG_LEVELS definitions |

### Data Flow

```
Logger → Transport → POST /api/logs → LogBuffer.addLog() + SQLite insert
                                                    ↓
Dashboard ← GET /api/logs?afterId=X ← LogBuffer query
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

Tests are in `tests/` using `bun:test`:
- `tests/setup.ts` resets LogBuffer and database between tests
- `tests/helpers/` contains test app factory and fixtures
- Pattern: use `createTestApp()` for isolated instances

Run a single test file:
```bash
bun test tests/api/logs-ingest.test.ts
```

## Environment Variables

```
PORT=4000
API_KEY=<optional>     # Enables X-API-KEY header auth
CORS_ORIGIN=*
```
