# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Abbacchio Dashboard** is the React frontend for the Abbacchio real-time log viewer. It connects to the API via HTTP polling, displays logs with filtering/search, and optionally persists logs in browser SQLite.

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
```

## Architecture

### Key Design Decisions

1. **Browser SQLite for Local Persistence**: Logs are stored in SQLite (sql.js) running in a Web Worker. All queries happen off-main-thread via `sqlite-worker.ts`.

2. **Two-Hook Pattern**:
   - `useChannelManager` manages HTTP polling, encryption, and channel state
   - `useLogStore` handles log processing, batching, and SQLite writes

3. **Client-Side Decryption**: Server passes encrypted payloads through unchanged. Decryption uses AES-256-GCM with user-provided key (`crypto.ts`).

4. **Batched Writes**: Incoming logs are batched (100ms interval) before SQLite insertion to reduce write overhead.

### Core Files

| File | Purpose |
|------|---------|
| `src/hooks/useChannelManager.ts` | HTTP polling, channel management, encryption |
| `src/hooks/useLogStore.ts` | Log processing, batching, SQLite persistence |
| `src/hooks/useChannelLogStream.ts` | Pagination, filtering, search |
| `src/lib/sqlite-db.ts` | Worker message interface for SQLite operations |
| `src/lib/sqlite-worker.ts` | Web Worker running sql.js with OPFS persistence |
| `src/lib/crypto.ts` | AES-256-GCM decryption using Web Crypto API |
| `src/components/LogViewer.tsx` | Main UI container |
| `src/components/LogRow.tsx` | Individual log entry display |
| `src/components/FilterBar.tsx` | Search and filter controls |

### Data Flow

```
HTTP polling /api/logs?afterId=X
    ↓
useChannelManager (poll → decrypt → batch)
    ↓
useLogStore (process → SQLite write)
    ↓
useChannelLogStream (SQL query with filters)
    ↓
LogViewer → LogRow (virtual scrolling via @tanstack/react-virtual)
```

### URL Parameters

The dashboard accepts query parameters for pre-configuration:
- `?channel=myapp` - Filter to specific channel
- `?key=secretkey` - Pre-set decryption key

### Path Alias

TypeScript is configured with `@/*` → `src/*` for imports:
```typescript
import { LogEntry } from '@/types';
import { useChannelLogStream } from '@/hooks/useChannelLogStream';
```

## Key Technologies

- **React 18** with functional components and hooks
- **Vite** for development and build
- **Tailwind CSS** + **Radix UI** for styling (components in `src/components/ui/`)
- **sql.js** in Web Worker for browser SQLite
- **@tanstack/react-virtual** for virtualized scrolling
