# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Abbacchio Dashboard** is the React frontend for the Abbacchio real-time log viewer. It loads logs from the API over HTTP, receives new ones over SSE, and displays logs, metrics, and traces with filtering/search.

## Monorepo Structure

This package is part of a pnpm workspace:
- `packages/dashboard` - React frontend (Vite + Tailwind) - **you are here**
- `packages/api` - Backend server (Hono framework, Bun runtime)
- `packages/transport` - Client libraries for loggers (Pino, Winston, Bunyan, Console)

## Common Commands

```bash
# From monorepo root
pnpm dev              # Run API (4000) + Dashboard (4001) with hot reload
pnpm build            # Build all packages

# From this package (packages/dashboard)
npm run dev           # Vite dev server on port 4001
npm run build         # tsc -b && vite build
npm run preview       # Preview production build
bun test tests        # Unit tests
```

## Architecture

### Key Design Decisions

1. **Server is the source of truth**: The dashboard keeps no local database. `usePolling` holds a bounded in-memory window of the active channel's logs (`MAX_LOGS_IN_MEMORY` = 50k in `lib/log-window.ts`); anything older is re-fetched from the server with backward pagination.

2. **SSE for live logs, HTTP for everything else**: New logs arrive over `/api/stream`; on reconnect the hook backfills the gap with `?afterId=`. Metrics, traces, counts, and the channel list are polled every few seconds.

3. **Server-side filters**: Level/namespace filters are sent to the API (`levels=`, `namespaces=`) and re-applied client-side to streamed logs.

4. **No decryption**: Encrypted entries are displayed as such; the dashboard has no decryption code.

### Core Files

| File | Purpose |
|------|---------|
| `src/hooks/usePolling.ts` | Initial load, SSE stream + reconnect backfill, backward pagination, metrics/traces/channels polling |
| `src/lib/log-window.ts` | Append/dedupe/cap logic for the in-memory log window (unit-tested in `tests/`) |
| `src/hooks/useFilterParams.ts` | Filter state synced to URL params |
| `src/hooks/useSqlQuery.ts` | Runs ad-hoc SQL via `POST /api/sql` |
| `src/components/LogViewer.tsx` | Main UI container |
| `src/components/LogRow.tsx` | Individual log entry display |
| `src/components/FilterBar.tsx` | Search and filter controls |
| `src/components/MetricsViewer.tsx` / `TracesViewer.tsx` | Metrics and traces views |

### Data Flow

```
GET /api/logs (newest 1000)  ─┐
GET /api/stream (SSE)        ─┼→ usePolling → bounded logs window → LogViewer → LogRow
GET /api/logs?beforeId= (older)┘                    (virtual scrolling via @tanstack/react-virtual)
```

### URL Parameters

- `?channel=myapp` - Select a channel
- `?paused=1` - Start with live updates paused
- `?levels=`, `?namespaces=`, `?time=`, `?q=`, `?case=`, `?regex=` - Pre-set filters
- `?view=` - Open a specific view

### Path Alias

TypeScript is configured with `@/*` → `src/*` for imports:
```typescript
import { LogEntry } from '@/types';
import { usePolling } from '@/hooks/usePolling';
```

## Key Technologies

- **React 18** with functional components and hooks
- **Vite** for development and build
- **Tailwind CSS** + **Radix UI** for styling (components in `src/components/ui/`)
- **@tanstack/react-virtual** for virtualized scrolling
