# Abbacchio Dashboard

React frontend for the Abbacchio real-time log viewer. Connects to the API via Server-Sent Events (SSE), displays logs with filtering/search, and optionally persists logs in browser SQLite.

## Getting Started

```bash
# From monorepo root
pnpm dev              # Run API (4000) + Dashboard (4001) with hot reload

# Or from this package
npm run dev           # Vite dev server on port 4001
npm run build         # Build for production
npm run preview       # Preview production build
```

## Features

- Real-time log streaming via SSE
- Multi-channel support with tabs
- Full-text search with highlighting
- Filter by level, namespace, and time range
- Client-side AES-256-GCM decryption
- Browser SQLite persistence (OPFS)
- Virtual scrolling for large log volumes
- i18n support (English, Spanish)

## URL Parameters

Pre-configure the dashboard via URL:

```
/?channel=myapp&key=your-encryption-key
```

| Parameter | Description |
|-----------|-------------|
| `channel` | Channel name to connect to |
| `key` | Encryption key for decrypting logs |

## Architecture

```
SSE /api/logs/stream
    ↓
useLogStore (decrypt → batch → SQLite write)
    ↓
useChannelLogStream (SQL query with filters)
    ↓
LogViewer → LogRow (virtual scrolling)
```

### Key Files

| File | Purpose |
|------|---------|
| `src/hooks/useChannelManager.ts` | Multi-channel state management |
| `src/hooks/useChannelLogStream.ts` | Pagination, filtering, search |
| `src/lib/sqlite-db.ts` | Worker message interface for SQLite |
| `src/lib/sqlite-worker.ts` | Web Worker running sql.js |
| `src/lib/crypto.ts` | AES-256-GCM decryption |

## Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool
- **Tailwind CSS** + **Radix UI** - Styling
- **sql.js** - Browser SQLite (Web Worker + OPFS)
- **@tanstack/react-virtual** - Virtualized scrolling
- **react-i18next** - Internationalization
