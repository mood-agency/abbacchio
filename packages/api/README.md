# @abbacchio/api

Real-time log server with HTTP ingestion and SQLite persistence, supporting multiple logging libraries (Pino, Winston, Bunyan, Console).

## Features

- **HTTP Polling**: Clients poll for new logs via `GET /api/logs?afterId=X`
- **SQLite Persistence**: Logs stored in SQLite via `bun:sqlite`
- **Multi-logger Support**: Works with Pino, Winston, Bunyan, and console
- **Channel Isolation**: Namespace logs by app/service
- **End-to-End Encryption**: Optional client-side encryption support
- **Production Ready**: Rate limiting, connection limits, backpressure handling
- **OTLP Support**: Native OTLP/HTTP JSON receiver for logs, metrics, and traces

## Installation

```bash
npm install @abbacchio/api
# or
pnpm add @abbacchio/api
```

## Quick Start

```bash
# Start the server (requires Bun runtime)
bun start

# Or with environment variables
PORT=4000 bun start
```

Send a test log:

```bash
curl -X POST http://localhost:4000/api/logs \
  -H "Content-Type: application/json" \
  -d '{"level": 30, "msg": "Hello world"}'
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/logs` | Ingest single or batch logs |
| `GET` | `/api/logs` | Get buffered logs (supports `afterId` for polling) |
| `DELETE` | `/api/logs` | Clear logs/channels |
| `GET` | `/api/channels` | List registered channels |
| `POST` | `/api/sql` | Execute SQL queries against stored logs |
| `GET` | `/api/stats` | Server statistics |
| `GET` | `/api/generate-key` | Generate encryption key |
| `GET` | `/health` | Health check |
| `POST` | `/v1/logs` | OTLP JSON log records |
| `POST` | `/v1/metrics` | OTLP JSON metric data points |
| `POST` | `/v1/traces` | OTLP JSON trace spans |

### Log Ingestion

**Single log:**
```bash
curl -X POST http://localhost:4000/api/logs \
  -H "Content-Type: application/json" \
  -H "X-Channel: my-app" \
  -d '{"level": 30, "msg": "User logged in", "userId": 123}'
```

**Batch logs:**
```bash
curl -X POST http://localhost:4000/api/logs \
  -H "Content-Type: application/json" \
  -d '{
    "logs": [
      {"level": 30, "msg": "Request started"},
      {"level": 30, "msg": "Request completed"}
    ]
  }'
```

### HTTP Polling

```javascript
let afterId = null;

setInterval(async () => {
  const params = new URLSearchParams({ channel: 'my-app' });
  if (afterId) params.set('afterId', afterId);

  const res = await fetch(`http://localhost:4000/api/logs?${params}`);
  const { logs } = await res.json();

  if (logs.length > 0) {
    afterId = logs[logs.length - 1].id;
    logs.forEach(log => console.log(log));
  }
}, 1000);
```

### Log Entry Format

```typescript
{
  id: string;           // Unique ID (nanoid)
  level: number;        // 10-60 (trace to fatal)
  levelLabel: string;   // trace|debug|info|warn|error|fatal
  time: number;         // Unix timestamp (ms)
  msg: string;          // Log message
  namespace?: string;   // Logger namespace
  channel: string;      // Channel/app identifier
  data: object;         // Additional fields
  encrypted?: boolean;  // True if encrypted
  encryptedData?: string; // Encrypted payload
}
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Server
PORT=4000
NODE_ENV=production
CORS_ORIGIN=*
API_KEY=your-secret-key        # Optional authentication

# Rate Limiting
ENABLE_RATE_LIMIT=true
RATE_LIMIT_WINDOW=60000        # 60 second window
RATE_LIMIT_MAX=1000            # 1000 requests per window

# Payload Limits
MAX_PAYLOAD_SIZE=1048576       # 1MB max payload
MAX_BATCH_SIZE=1000            # 1000 logs per batch
MAX_SINGLE_LOG_SIZE=65536      # 64KB per log

# Channels
MAX_CHANNELS=10000             # Max registered channels
CHANNEL_TTL=86400000           # 24 hour TTL for inactive channels

# Shutdown
SHUTDOWN_TIMEOUT=30000         # 30 second graceful shutdown
```

## Authentication

Enable API key authentication by setting `API_KEY`:

```bash
API_KEY=my-secret-key bun start
```

Then include the key in requests:

```bash
curl -X POST http://localhost:4000/api/logs \
  -H "X-API-KEY: my-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"level": 30, "msg": "Authenticated log"}'
```

## Encryption

Generate an encryption key:

```bash
curl http://localhost:4000/api/generate-key
# {"key": "base64url-encoded-key"}
```

Send encrypted logs (encryption happens client-side):

```bash
curl -X POST http://localhost:4000/api/logs \
  -H "Content-Type: application/json" \
  -d '{"encrypted": "base64-encrypted-payload"}'
```

The server passes encrypted payloads through unchanged. Decryption happens in the dashboard with the user's key.

## Development

```bash
# Install dependencies
pnpm install

# Run with hot reload
bun run dev

# Run tests
bun test
bun test --watch

# Build
pnpm build

# Type check
pnpm tsc --noEmit
```

## Architecture

```
Logger → Transport → POST /api/logs → LogBuffer.add() + SQLite insert
                                                    ↓
Dashboard ← GET /api/logs?afterId=X ← LogBuffer query
```

### Key Components

| Component | Purpose |
|-----------|---------|
| `LogBuffer` | In-memory ring buffer for log polling, channel management |
| `LogDatabase` | SQLite persistence layer (bun:sqlite) |
| `IdPool` | Pre-generated IDs for high-throughput ingestion |
| `RateLimiter` | Token bucket rate limiting per IP |
| `Validator` | Payload size and batch validation |

### Scalability Features

- **Rate Limiting**: Token bucket per IP (default 1000 req/min)
- **Channel Limits**: LRU eviction when channel limit reached
- **ID Pool**: Pre-generated IDs eliminate crypto overhead on hot path
- **Pre-serialization**: JSON serialized once per log, shared across clients
- **Graceful Shutdown**: Clean shutdown on SIGTERM/SIGINT

## Health Check

```bash
curl http://localhost:4000/health
```

Response:
```json
{
  "status": "ok",
  "uptime": 3600.5,
  "channels": 5
}
```

## License

MIT
