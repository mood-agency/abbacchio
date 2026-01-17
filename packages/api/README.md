# @abbacchio/api

Real-time log streaming server with HTTP ingestion supporting multiple logging libraries (Pino, Winston, Bunyan, Console).

## Features

- **Real-time Streaming**: SSE-based log streaming to connected clients
- **Multi-logger Support**: Works with Pino, Winston, Bunyan, and console
- **Channel Isolation**: Namespace logs by app/service
- **End-to-End Encryption**: Optional client-side encryption support
- **Production Ready**: Rate limiting, connection limits, backpressure handling
- **Zero Storage**: Logs stream through without server-side persistence

## Installation

```bash
npm install @abbacchio/api
# or
pnpm add @abbacchio/api
```

## Quick Start

```bash
# Start the server
npm start

# Or with environment variables
PORT=4000 npm start
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
| `GET` | `/api/logs/stream?channel=X` | SSE stream for real-time logs |
| `GET` | `/api/logs` | Get buffered logs (empty in streaming mode) |
| `DELETE` | `/api/logs` | Clear logs/channels |
| `GET` | `/api/channels` | List registered channels |
| `GET` | `/api/stats` | Server statistics |
| `GET` | `/api/generate-key` | Generate encryption key |
| `GET` | `/health` | Health check |

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

### SSE Streaming

```javascript
const eventSource = new EventSource('http://localhost:4000/api/logs/stream?channel=my-app');

eventSource.addEventListener('log', (e) => {
  const log = JSON.parse(e.data);
  console.log(log);
});

eventSource.addEventListener('batch', (e) => {
  const logs = JSON.parse(e.data);
  logs.forEach(log => console.log(log));
});
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

# Connection Limits
MAX_CONNECTIONS=1000           # Max concurrent SSE connections
CONNECTION_TIMEOUT=3600000     # 1 hour timeout

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

# Backpressure
MAX_QUEUE_SIZE=1000            # Queue size per connection

# Shutdown
SHUTDOWN_TIMEOUT=30000         # 30 second graceful shutdown
```

## Authentication

Enable API key authentication by setting `API_KEY`:

```bash
API_KEY=my-secret-key npm start
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
pnpm dev

# Run tests
pnpm test
pnpm test:watch
pnpm test:coverage

# Build
pnpm build

# Type check
pnpm tsc --noEmit
```

## Architecture

```
Logger → Transport → POST /api/logs → LogBuffer.add() → emit('log')
                                                            ↓
Dashboard ← SSE /api/logs/stream ← EventEmitter listener
```

### Key Components

| Component | Purpose |
|-----------|---------|
| `LogBuffer` | EventEmitter for log broadcasting, channel management |
| `ConnectionManager` | SSE connection tracking, limits, stale detection |
| `IdPool` | Pre-generated IDs for high-throughput ingestion |
| `RateLimiter` | Token bucket rate limiting per IP |
| `Validator` | Payload size and batch validation |

### Scalability Features

- **Connection Limits**: Configurable max SSE connections (default 1000)
- **Rate Limiting**: Token bucket per IP (default 1000 req/min)
- **Backpressure**: Per-connection message queues with overflow handling
- **Channel Limits**: LRU eviction when channel limit reached
- **ID Pool**: Pre-generated IDs eliminate crypto overhead on hot path
- **Pre-serialization**: JSON serialized once per log, shared across clients
- **Graceful Shutdown**: Clean connection closure on SIGTERM/SIGINT

## Health Check

```bash
curl http://localhost:4000/health
```

Response:
```json
{
  "status": "ok",
  "uptime": 3600.5,
  "connections": 42,
  "maxConnections": 1000,
  "channels": 5
}
```

## Statistics

```bash
curl http://localhost:4000/api/stats
```

Response:
```json
{
  "connections": {
    "totalConnections": 42,
    "connectionsByChannel": { "app-1": 20, "app-2": 22 },
    "totalBytesSent": 1048576,
    "totalMessagesSent": 5000,
    "totalMessagesDropped": 0
  },
  "channels": {
    "channelCount": 5,
    "maxChannels": 10000,
    "channels": [...]
  }
}
```

## License

MIT
