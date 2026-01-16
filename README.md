# pino-live

Real-time log viewer dashboard with HTTP ingestion. Send logs from any application (Pino, Winston, or any HTTP client) and view them in a beautiful, searchable UI.

## Features

- **Real-time streaming** via Server-Sent Events (SSE)
- **Multi-channel support** - view logs from multiple apps in one dashboard
- **End-to-end encryption** - encrypt logs before sending, decrypt in browser
- **Built-in Pino transport** - zero-config integration with Pino
- **Searchable** - full-text search across all log fields
- **Filterable** - by log level, channel, and namespace
- **Expandable JSON** - click to expand structured data
- **Dark/Light mode** - automatic system preference detection
- **Auto-scroll** - pauses when you scroll up, with "new logs" indicator
- **Zero persistence** - logs stay in memory only

## Quick Start

### 1. Start the server

```bash
npx pino-live
# or
pnpm dlx pino-live
```

Dashboard available at http://localhost:4000

### 2. Send logs

**Using the built-in Pino transport (recommended):**
```typescript
import pino from 'pino';

const logger = pino({
  transport: {
    targets: [
      // Console output
      { target: 'pino-pretty' },
      // Send to pino-live
      {
        target: 'pino-live/transport',
        options: {
          url: 'http://localhost:4000/api/logs',
          channel: 'my-app',        // Optional: identify your app
          secretKey: 'my-secret',   // Optional: encrypt logs
          batchSize: 10,
          interval: 1000
        }
      }
    ]
  }
});

logger.info({ user: 'john' }, 'User logged in');
```

**Using curl:**
```bash
curl -X POST http://localhost:4000/api/logs \
  -H "Content-Type: application/json" \
  -H "X-Channel: my-app" \
  -d '{"level":30,"msg":"Hello from curl"}'
```

**Using fetch:**
```javascript
fetch('http://localhost:4000/api/logs', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Channel': 'frontend'
  },
  body: JSON.stringify({
    level: 30,
    msg: 'Hello from JavaScript',
    time: Date.now(),
    data: { foo: 'bar' }
  })
});
```

## Multi-Channel Support

Send logs from multiple applications to the same pino-live server. Each app identifies itself with a channel name.

**Transport configuration:**
```typescript
{
  target: 'pino-live/transport',
  options: {
    url: 'http://localhost:4000/api/logs',
    channel: 'api-server'  // Logs will be tagged with this channel
  }
}
```

**HTTP header:**
```bash
curl -X POST http://localhost:4000/api/logs \
  -H "X-Channel: worker-service" \
  -d '{"level":30,"msg":"Processing job"}'
```

**Query parameter:**
```bash
curl -X POST "http://localhost:4000/api/logs?channel=cron-jobs" \
  -d '{"level":30,"msg":"Running scheduled task"}'
```

In the dashboard, a channel filter appears when multiple channels are detected. Type to filter by channel name (supports partial matching).

## End-to-End Encryption

Encrypt logs client-side before sending. The server only stores encrypted blobs - decryption happens in your browser.

**Enable encryption in transport:**
```typescript
{
  target: 'pino-live/transport',
  options: {
    url: 'http://localhost:4000/api/logs',
    secretKey: process.env.PINO_LIVE_SECRET_KEY  // AES-256-GCM
  }
}
```

**In the dashboard:**
1. Encrypted logs show a lock icon
2. Click "Set key" in the header
3. Enter your secret key to decrypt

Encryption uses AES-256-GCM with PBKDF2 key derivation (100,000 iterations). The key is stored in localStorage for convenience.

## Transport Options

The built-in transport (`pino-live/transport`) supports these options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | string | `http://localhost:4000/api/logs` | pino-live server URL |
| `channel` | string | `default` | Channel name for multi-app support |
| `secretKey` | string | - | Encryption key (enables E2E encryption) |
| `batchSize` | number | `10` | Send batch when this many logs accumulate |
| `interval` | number | `1000` | Send batch after this many ms (even if not full) |
| `headers` | object | `{}` | Additional HTTP headers |

## API Reference

### POST /api/logs

Ingest logs (single or batch).

**Headers:**
- `Content-Type: application/json` (required)
- `X-Channel: <name>` (optional) - Channel identifier

**Single log:**
```json
{
  "level": 30,
  "time": 1705420800000,
  "msg": "Request completed",
  "namespace": "http",
  "req": { "method": "GET", "url": "/api/users" }
}
```

**Batch:**
```json
{
  "logs": [
    { "level": 30, "msg": "Log 1" },
    { "level": 40, "msg": "Log 2" }
  ]
}
```

**Encrypted log:**
```json
{
  "encrypted": "base64-encoded-ciphertext"
}
```

**Response:** `201 Created`
```json
{ "received": 2, "channel": "my-app" }
```

### GET /api/logs/stream

SSE endpoint for real-time logs.

**Query params:**
- `channel` - Filter by specific channel (optional)

**Events:**
- `batch` - Initial batch of buffered logs
- `log` - New log entry
- `channels` - List of available channels
- `channel:added` - New channel detected
- `ping` - Keep-alive (every 15s)

### GET /api/logs

Get all buffered logs.

**Query params:**
- `channel` - Filter by specific channel (optional)

### DELETE /api/logs

Clear logs from buffer.

**Query params:**
- `channel` - Clear only specific channel (optional, default: all)

### GET /api/channels

Get list of available channels.

**Response:**
```json
{ "channels": ["default", "api-server", "worker"] }
```

### GET /api/generate-key

Generate a cryptographically secure random encryption key.

**Query params:**
- `length` - Key length in bytes (default: 32, min: 16, max: 64)

**Response:**
```json
{ "key": "Yx2kL9mN3pQ7rS1tU5vW8xZ0aB4cD6eF..." }
```

**Example:**
```bash
curl http://localhost:4000/api/generate-key
curl http://localhost:4000/api/generate-key?length=48
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Server port |
| `LOG_BUFFER_SIZE` | `1000` | Max logs in memory |
| `API_KEY` | - | Optional API key for authentication |
| `CORS_ORIGIN` | `*` | CORS allowed origins |

## Log Format

pino-live expects logs in Pino format but is flexible:

| Field | Type | Description |
|-------|------|-------------|
| `level` | number | Log level (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal) |
| `time` | number | Unix timestamp in ms (default: now) |
| `msg` or `message` | string | Log message |
| `namespace` or `name` | string | Logger namespace (optional) |
| `...` | any | Additional fields shown in expandable JSON |

## Dashboard Features

### URL Parameters

Pre-configure the dashboard via URL parameters:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `channel` | Pre-fill channel filter | `?channel=api-server` |
| `key` | Set encryption key | `?key=my-secret` |

**Examples:**
```
http://localhost:4000/dashboard?channel=api
http://localhost:4000/dashboard?key=my-secret-key
http://localhost:4000/dashboard?channel=api&key=my-secret
```

This is useful for:
- Bookmarking filtered views for specific apps
- Sharing links with the encryption key pre-filled
- Creating multiple browser tabs for different channels

### Filtering

- **Level** - Dropdown to filter by trace/debug/info/warn/error/fatal
- **Channel** - Text input to filter by channel (partial match)
- **Namespace** - Text input to filter by namespace (partial match)
- **Search** - Full-text search across message, namespace, channel, and JSON data

### Visual Indicators

- **Level badges** - Color-coded (green=info, yellow=warn, red=error, etc.)
- **Channel badges** - Cyan badges showing channel name (when multiple channels)
- **Namespace badges** - Purple badges for logger namespace
- **Lock icon** - Indicates encrypted log (needs key to decrypt)
- **Warning icon** - Decryption failed (wrong key)

### Keyboard Shortcuts

- Scroll up to pause auto-scroll
- Click "New logs" button to jump to latest

## Development

```bash
# Clone the repo
git clone https://github.com/yourusername/pino-live.git
cd pino-live

# Install dependencies
pnpm install

# Run in development mode (server + dashboard hot reload)
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

### Test Log Generator

Generate test logs to populate the dashboard during development:

```bash
npx tsx scripts/insert-test-logs.ts [options]
```

**Options:**

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--count` | `-c` | `5` | Number of logs per channel |
| `--delay` | `-d` | `100` | Delay between logs in ms |
| `--key` | `-k` | - | Encryption key (optional) |
| `--name` | `-n` | random | Log name/namespace |

**Examples:**

```bash
# Send 5 logs per channel with 100ms delay
npx tsx scripts/insert-test-logs.ts

# Send 20 logs per channel with 50ms delay
npx tsx scripts/insert-test-logs.ts --count 20 --delay 50

# Send encrypted logs
npx tsx scripts/insert-test-logs.ts --key my-secret-key

# Send logs with a specific namespace
npx tsx scripts/insert-test-logs.ts --name my-service

# Combined options
npx tsx scripts/insert-test-logs.ts -c 10 -d 25 -k secret -n api
```

Logs are sent to 3 channels: `optimus`, `bumblebee`, `jazz`.

## License

MIT
