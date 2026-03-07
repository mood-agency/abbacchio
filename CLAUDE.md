# Abbacchio - Project Guide for Claude Code

## Overview

Abbacchio is a real-time log viewer dashboard with HTTP ingestion. It works with any logging library (Pino, Winston, Bunyan, console) via HTTP transports. Logs are delivered in real-time via HTTP polling and displayed in a searchable, filterable UI.

## Project Structure

This is a **pnpm monorepo** with the following packages:

```
packages/
├── api/          # Hono-based HTTP server (Bun runtime, SQLite persistence)
├── dashboard/    # React frontend (Vite + TailwindCSS)
├── transport/    # Node.js transports for Pino, Winston, Bunyan
├── browser-transport/  # Browser-side transport for sending logs
├── tui/          # Terminal UI for viewing logs (Ink + React)
├── desktop/      # Tauri desktop app wrapper
├── mcp/          # MCP server for Claude Code integration
python/           # Python transport package (PyPI: abbacchio)
```

## Key Commands

```bash
# Development
pnpm dev              # Start API + dashboard concurrently
pnpm dev:api          # Start only API server
pnpm dev:dashboard    # Start only dashboard
pnpm dev:tui          # Start terminal UI
pnpm dev:desktop      # Start desktop app (Tauri)

# Building
pnpm build            # Build all packages
pnpm build:api        # Build API only
pnpm build:transport  # Build transport only

# Running
pnpm start            # Start production API server
pnpm tui              # Run TUI with arguments (e.g., pnpm tui -- --channel myapp)

# Testing
pnpm test             # Run all tests
```

## Architecture

### Log Flow
1. Application sends logs via HTTP POST to `/api/logs` (or `/api/logs/:channel`)
2. API server stores logs in SQLite and in-memory buffer
3. Dashboard/TUI polls `/api/logs` for new logs via HTTP polling
4. Real-time delivery of new logs to all connected clients

### Key Technologies
- **API**: Hono (lightweight web framework), Bun runtime, SQLite (bun:sqlite)
- **Dashboard**: React 19, Vite, TailwindCSS, shadcn/ui components
- **TUI**: Ink (React for CLI), blessed-contrib
- **Desktop**: Tauri (Rust-based desktop wrapper)
- **Transports**: pino-abstract-transport pattern

### Encryption
Optional end-to-end encryption using Web Crypto API (AES-GCM). Logs are encrypted client-side before sending and decrypted in the browser.

## Package Publishing

- Main package publishes to npm as `abbacchio`
- Transport package publishes as `@abbacchio/transport`
- TUI publishes as `@abbacchio/tui`
- Python package publishes to PyPI as `abbacchio`

## Important Files

- `packages/api/src/server.ts` - Main API server entry point
- `packages/api/src/routes/logs.handlers.ts` - Log ingestion and retrieval handlers
- `packages/api/src/lib/database.ts` - SQLite persistence layer
- `packages/dashboard/src/App.tsx` - Dashboard main component
- `packages/dashboard/src/hooks/useChannelManager.ts` - HTTP polling and channel management
- `packages/transport/src/transports/pino.ts` - Pino transport implementation

## Conventions

- TypeScript throughout (except Python package)
- ESM modules (`"type": "module"`)
- Bun runtime for API, Node.js 18+ for other packages
- Uses Biome for formatting/linting in some packages
