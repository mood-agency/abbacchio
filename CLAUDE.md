# Abbacchio - Project Guide for Claude Code

## Overview

Abbacchio is a real-time log viewer dashboard with HTTP ingestion. It works with any logging library (Pino, Winston, Bunyan, console) via HTTP transports, and also accepts OTLP/HTTP JSON logs, metrics, and traces. New logs are pushed to the dashboard over SSE and displayed in a searchable, filterable UI.

## Project Structure

This is a **bun workspaces monorepo** with the following packages:

```
packages/
├── api/          # Hono-based HTTP server (Bun runtime, SQLite persistence)
├── dashboard/    # React frontend (Vite + TailwindCSS)
├── transport/    # Node.js transports for Pino, Winston, Bunyan
├── browser-transport/  # Browser-side transport for sending logs
├── tui/          # Terminal UI for viewing logs (Ink + React)
├── desktop/      # Tauri desktop app wrapper
├── mcp/          # MCP server for Claude Code integration
python/           # Python transport package (PyPI: abbacchio-transport)
```

## Key Commands

```bash
# Development
bun run dev              # Start API + dashboard concurrently
bun run dev:api          # Start only API server
bun run dev:dashboard    # Start only dashboard
bun run dev:tui          # Start terminal UI
bun run dev:desktop      # Start desktop app (Tauri)

# Building
bun run build            # Build all packages
bun run build:api        # Build API only
bun run build:transport  # Build transport only

# Running
bun run start            # Start production API server
bun run tui              # Run TUI with arguments (e.g., bun run tui --channel myapp)

# Testing
bun run test             # Run all tests
```

## Architecture

### Log Flow
1. Applications send telemetry over HTTP:
   - Node and browser transports send OTLP JSON to `/v1/logs`, `/v1/metrics`, `/v1/traces`
   - The Python transport (and plain `curl`) POST to `/api/logs` (channel via `X-Channel` or `?channel=`)
2. API server stores logs in SQLite and an in-memory buffer
3. Dashboard loads the newest logs from `GET /api/logs`, receives new ones over SSE (`/api/stream`), and pages older ones with `?beforeId=`
4. TUI polls `GET /api/logs?afterId=` every second

### Key Technologies
- **API**: Hono (lightweight web framework), Bun runtime, SQLite (bun:sqlite)
- **Dashboard**: React 19, Vite, TailwindCSS, shadcn/ui components
- **TUI**: Ink (React for CLI), blessed-contrib
- **Desktop**: Tauri (Rust-based desktop wrapper)
- **Transports**: pino-abstract-transport pattern

### Encryption
The API passes `{ encrypted: ... }` payloads through unchanged. Only the TUI decrypts them today (`packages/tui/src/lib/crypto.ts`); the dashboard shows encrypted entries but has no decryption, and the Node/browser transports do not encrypt.

## Package Publishing

- Main package publishes to npm as `abbacchio`
- Transport package publishes as `@abbacchio/transport`
- TUI publishes as `@abbacchio/tui`
- Python package publishes to PyPI as `abbacchio-transport`

## Important Files

- `packages/api/src/server.ts` - Main API server entry point
- `packages/api/src/routes/logs.handlers.ts` - Log ingestion and retrieval handlers
- `packages/api/src/lib/database.ts` - SQLite persistence layer
- `packages/dashboard/src/App.tsx` - Dashboard main component
- `packages/dashboard/src/hooks/usePolling.ts` - Initial load, SSE stream, pagination, and channel management
- `packages/transport/src/client.ts` - Shared OTLP client (batching, 429 backoff, buffer caps)
- `packages/transport/src/transports/pino.ts` - Pino transport implementation

## Conventions

- TypeScript throughout (except Python package)
- ESM modules (`"type": "module"`)
- Bun runtime for API, Node.js 18+ for other packages
- Uses Biome for formatting/linting in some packages
