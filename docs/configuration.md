# Configuration

## Environment Variables

| Variable               | Default          | Description |
| ---------------------- | ---------------- | ----------- |
| `PORT`                 | `4000`           | Server port |
| `API_KEY`              | -                | Optional API key for authentication (enables `X-API-KEY` header auth) |
| `CORS_ORIGIN`          | `*`              | CORS allowed origins (comma-separated for multiple) |
| `MAX_LOGS_PER_CHANNEL` | `5000`           | Max logs retained **in the in-memory ring buffer** per channel. `0` = retain nothing (disk-only mode — see below). |
| `MAX_CHANNELS`         | `10000`          | Max registered channels in memory (LRU eviction beyond this). |
| `CHANNEL_TTL`          | `86400000` (24h) | A channel with no activity for this long is dropped from the in-memory buffer. Does **not** delete its persisted SQLite rows. |
| `SQLITE_PATH`          | `./data/logs.db` | Path to the SQLite database. Use `:memory:` for an ephemeral RAM database (wiped on restart). |
| `SQLITE_MAX_LOGS`      | `100000`         | Max logs kept on disk. Older logs are pruned by rowid. `0` = unlimited. |
| `SQLITE_TTL_MS`        | `0`              | Time-based retention in ms. If > 0, logs older than this are pruned. `0` = disabled (count-cap only). |
| `SQLITE_EPHEMERAL`     | `false`          | If `true`, deletes the SQLite database file on startup. |
| `SQLITE_CACHE_SIZE`    | `-64000` (64 MB) | SQLite page cache. Negative = KiB. Lower to reduce RAM footprint. |
| `SQLITE_MMAP_SIZE`     | `268435456` (256 MB) | Memory-mapped I/O size in bytes. Set `0` to disable mmap and minimize RAM. |

## Storage & Retention — design decisions

Abbacchio uses **dual storage**: every ingested log is written to *both* an
in-memory ring buffer and SQLite, in the same request (`logs.handlers.ts`).
These two layers serve different jobs.

### 1. In-memory ring buffer (`log-buffer.ts`)

- **Always active.** It is written on every log, unconditionally.
- **Two responsibilities:**
  1. **Real-time event bus.** It is an `EventEmitter`; the SSE stream
     (`GET /api/stream`, used by the dashboard's `EventSource`) is driven by
     its `'logs'` event. SQLite has no change-notification mechanism, so this
     is the only way to push new logs to connected clients in real time.
  2. **Fast poll cache.** `GET /api/logs?afterId=X` is served from the buffer
     when possible; it falls back to SQLite when the requested id has aged out
     of the buffer or when server-side filters are active.
- **Bounded by** `MAX_LOGS_PER_CHANNEL`, `MAX_CHANNELS`, `CHANNEL_TTL`.

### 2. SQLite (`database.ts`)

- The durable source of truth and the backend for SQL queries, pagination,
  counts, and full-text search.
- **Retention runs every 30s** (`pruneIfNeeded`) with two independent caps —
  whichever is hit first wins:
  - **Time-based** (`SQLITE_TTL_MS`): deletes logs/metrics/traces older than
    `now - ttl`.
  - **Count-based** (`SQLITE_MAX_LOGS`): keeps only the newest N rows (O(1)
    rowid-offset delete, no `COUNT(*)`).

### Disk reclamation (incremental auto-vacuum)

`DELETE` alone does **not** shrink the SQLite file — freed pages are reused but
the file stays at its high-water mark. To make retention actually return disk
to the OS, the database is opened with `PRAGMA auto_vacuum = INCREMENTAL` (set
before table creation, with a one-time `VACUUM` to convert pre-existing DBs),
and each prune pass runs `PRAGMA incremental_vacuum`. This keeps `logs.db`
tracking *average* volume rather than *peak*.

### "Disk-only" mode

To make disk the single source of truth and hold ~nothing in RAM, set
`MAX_LOGS_PER_CHANNEL=0`. The buffer then drops every log immediately *after*
emitting its event, so:

- Real-time SSE streaming still works (events still fire).
- Every read query falls back to SQLite.
- Logs persist only on disk, governed by `SQLITE_TTL_MS` / `SQLITE_MAX_LOGS`.

The buffer object itself cannot be removed — it is the SSE event bus — but in
this mode it stores no logs. Note that SQLite still memory-maps/caches via
`SQLITE_MMAP_SIZE` and `SQLITE_CACHE_SIZE`; lower those to further reduce RAM.

> Tip: with `synchronous = OFF` (the default high-throughput setting), a hard
> crash can lose the last few hundred ms of un-flushed logs. This is an
> intentional speed/durability trade-off appropriate for a log viewer.

## Example configurations

**Persistent, 7-day retention on disk (recommended for long-lived servers):**

```bash
SQLITE_PATH=./data/logs.db
SQLITE_TTL_MS=604800000      # 7 days
SQLITE_MAX_LOGS=50000        # also cap by count (whichever hits first)
```

**Disk-only (minimal RAM retention):**

```bash
SQLITE_PATH=./data/logs.db
MAX_LOGS_PER_CHANNEL=0       # buffer holds nothing; all reads hit disk
SQLITE_TTL_MS=604800000
```

**Ephemeral / AI agent sandbox (everything in RAM, OOM-bounded):**

```bash
SQLITE_PATH=:memory:
SQLITE_MAX_LOGS=50000        # strictly bounds RAM (~50MB)
SQLITE_TTL_MS=1800000        # prune logs older than 30 min
```
