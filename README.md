# Abbacchio

Real-time log viewer dashboard with HTTP ingestion. Works with **any logging library** - Pino, Winston, Bunyan, or plain console. Send logs from your application and view them in a beautiful, searchable UI.

## Features

- **Multi-logger support** - Pino, Winston, Bunyan, Console, or any HTTP client
- **Real-time streaming** via Server-Sent Events (SSE)
- **Multi-channel support** - view logs from multiple apps in one dashboard
- **End-to-end encryption** - encrypt logs before sending, decrypt in browser
- **Searchable** - full-text search across all log fields
- **Filterable** - by log level, channel, and namespace
- **Expandable JSON** - click to expand structured data
- **Dark/Light mode** - automatic system preference detection
- **Auto-scroll** - pauses when you scroll up, with "new logs" indicator
- **Zero persistence** - logs stay in memory only

## Quick Start

### 1. Start the server

```bash
npx abbacchio
# or
pnpm dlx abbacchio
```

Dashboard available at http://localhost:4000

### 2. Send logs

Choose your logging library:

#### Pino

```typescript
import pino from "pino";

const logger = pino({
  transport: {
    targets: [
      { target: "pino-pretty" },
      {
        target: "abbacchio/transports/pino",
        options: {
          url: "http://localhost:4000/api/logs",
          channel: "my-app",
        },
      },
    ],
  },
});

logger.info({ user: "john" }, "User logged in");
```

#### Winston

```typescript
import winston from "winston";
import { winstonTransport } from "abbacchio/transports/winston";

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    winstonTransport({
      url: "http://localhost:4000/api/logs",
      channel: "my-app",
    }),
  ],
});

logger.info("User logged in", { user: "john" });
```

#### Bunyan

```typescript
import bunyan from "bunyan";
import { bunyanStream } from "abbacchio/transports/bunyan";

const logger = bunyan.createLogger({
  name: "myapp",
  streams: [
    { stream: process.stdout },
    bunyanStream({
      url: "http://localhost:4000/api/logs",
      channel: "my-app",
    }),
  ],
});

logger.info({ user: "john" }, "User logged in");
```

#### Console

```typescript
import { interceptConsole, restoreConsole } from "abbacchio/transports/console";

// Start intercepting console calls
interceptConsole({
  url: "http://localhost:4000/api/logs",
  channel: "my-app",
  passthrough: true, // Still log to console
});

console.log("This will be sent to Abbacchio!");
console.error("Errors too!");

// Stop intercepting when done
restoreConsole();
```

#### Using curl

```bash
curl -X POST http://localhost:4000/api/logs \
  -H "Content-Type: application/json" \
  -H "X-Channel: my-app" \
  -d '{"level":30,"msg":"Hello from curl"}'
```

#### Using fetch

```javascript
fetch("http://localhost:4000/api/logs", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Channel": "frontend",
  },
  body: JSON.stringify({
    level: 30,
    msg: "Hello from JavaScript",
    time: Date.now(),
    data: { foo: "bar" },
  }),
});
```

## Transport Options

All transports share these common options:

| Option      | Type   | Default                          | Description                            |
| ----------- | ------ | -------------------------------- | -------------------------------------- |
| `url`       | string | `http://localhost:4000/api/logs` | Abbacchio server URL                   |
| `channel`   | string | `default`                        | Channel name for multi-app support     |
| `secretKey` | string | -                                | Encryption key (enables E2E encryption)|
| `batchSize` | number | `10`                             | Send batch when this many logs accumulate |
| `interval`  | number | `1000`                           | Send batch after this many ms          |
| `headers`   | object | `{}`                             | Additional HTTP headers                |

### Pino-specific

```typescript
import pino from "pino";

const logger = pino({
  transport: {
    target: "abbacchio/transports/pino",
    options: {
      url: "http://localhost:4000/api/logs",
      channel: "api-server",
      secretKey: process.env.ABBACCHIO_SECRET_KEY,
    },
  },
});
```

### Winston-specific

```typescript
import { winstonTransport } from "abbacchio/transports/winston";

const transport = winstonTransport({
  url: "http://localhost:4000/api/logs",
  channel: "api-server",
  level: "debug", // Winston log level filter
});
```

### Bunyan-specific

```typescript
import { bunyanStream } from "abbacchio/transports/bunyan";

const stream = bunyanStream({
  url: "http://localhost:4000/api/logs",
  channel: "api-server",
  level: "debug", // Bunyan log level filter
});
```

### Console-specific

```typescript
import { interceptConsole } from "abbacchio/transports/console";

interceptConsole({
  url: "http://localhost:4000/api/logs",
  channel: "browser-app",
  methods: ["log", "warn", "error"], // Which methods to intercept
  passthrough: true, // Also output to original console
});
```

## Multi-Channel Support

Send logs from multiple applications to the same Abbacchio server. Each app identifies itself with a channel name.

**Transport configuration:**

```typescript
{
  target: 'abbacchio/transports/pino',
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

In the dashboard, a channel filter appears when multiple channels are detected.

## End-to-End Encryption

Encryption is **built into the transports** - just add a `secretKey` option and your logs are automatically encrypted before being sent. No extra libraries needed.

**How it works:**

1. You add `secretKey` to your transport options (same setup as Quick Start, just add one option)
2. Logs are encrypted **in your application** before being sent to the server
3. The server only stores encrypted data - it cannot read your logs
4. The `secretKey` is **never transmitted** over the network
5. To view logs, enter the same key in the dashboard

**Enable encryption (just add `secretKey`):**

```typescript
import pino from "pino";

const logger = pino({
  transport: {
    targets: [
      { target: "pino-pretty" },
      {
        target: "abbacchio/transports/pino",
        options: {
          url: "http://localhost:4000/api/logs",
          channel: "my-app",
          secretKey: process.env.LOG_SECRET_KEY, // <- just add this line
        },
      },
    ],
  },
});

logger.info({ user: "john" }, "User logged in"); // automatically encrypted!
```

The same `secretKey` option works for all transports (Winston, Bunyan, Console).

**Viewing encrypted logs in the dashboard:**

1. Encrypted logs show a lock icon 🔒
2. Click "Set key" in the header
3. Enter the same `secretKey` used in your application

You can also pass the key via URL: `http://localhost:4000/dashboard?key=your-secret-key`

Encryption uses AES-256-GCM with PBKDF2 key derivation (100,000 iterations).

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

- `channel` - Filter by specific channel (required)

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

## Configuration

Environment variables:

| Variable          | Default | Description                     |
| ----------------- | ------- | ------------------------------- |
| `PORT`            | `4000`  | Server port                     |
| `LOG_BUFFER_SIZE` | `1000`  | Max logs in memory              |
| `API_KEY`         | -       | Optional API key for authentication |
| `CORS_ORIGIN`     | `*`     | CORS allowed origins            |

## Log Format

Abbacchio normalizes logs from different libraries:

| Field                  | Type   | Description                               |
| ---------------------- | ------ | ----------------------------------------- |
| `level`                | number | Log level (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal) |
| `time`                 | number | Unix timestamp in ms (default: now)       |
| `msg` or `message`     | string | Log message                               |
| `namespace` or `name`  | string | Logger namespace (optional)               |
| `...`                  | any    | Additional fields shown in expandable JSON|

## Dashboard Features

### URL Parameters

Pre-configure the dashboard via URL parameters:

| Parameter | Description              | Example               |
| --------- | ------------------------ | --------------------- |
| `channel` | Pre-fill channel filter  | `?channel=api-server` |
| `key`     | Set encryption key       | `?key=my-secret`      |

**Examples:**

```
http://localhost:4000/dashboard?channel=api
http://localhost:4000/dashboard?key=my-secret-key
http://localhost:4000/dashboard?channel=api&key=my-secret
```

### Filtering

- **Level** - Dropdown to filter by trace/debug/info/warn/error/fatal
- **Channel** - Text input to filter by channel (partial match)
- **Namespace** - Text input to filter by namespace (partial match)
- **Search** - Full-text search across message, namespace, channel, and JSON data

### Visual Indicators

- **Level badges** - Color-coded (green=info, yellow=warn, red=error, etc.)
- **Channel badges** - Cyan badges showing channel name
- **Namespace badges** - Purple badges for logger namespace
- **Lock icon** - Indicates encrypted log (needs key to decrypt)
- **Warning icon** - Decryption failed (wrong key)

## Development

```bash
# Clone the repo
git clone https://github.com/yourusername/abbacchio.git
cd abbacchio

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

| Option    | Short | Default | Description                  |
| --------- | ----- | ------- | ---------------------------- |
| `--count` | `-c`  | `5`     | Number of logs per channel   |
| `--delay` | `-d`  | `100`   | Delay between logs in ms     |
| `--key`   | `-k`  | -       | Encryption key (optional)    |
| `--name`  | `-n`  | random  | Log name/namespace           |

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
```

## License

MIT
