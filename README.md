# Abbacchio

Real-time log viewer dashboard with HTTP ingestion. Works with **any logging library** - Pino, Winston, Bunyan, or plain console. Send logs from your application and view them in a beautiful, searchable UI.

## Features

- **Multi-logger support** - Pino, Winston, Bunyan, Console, or any HTTP client
- **OpenTelemetry native** - OTLP/HTTP JSON receiver for logs, metrics, and traces
- **Real-time streaming** via HTTP polling
- **Multi-channel support** - view logs from multiple apps in one dashboard
- **End-to-end encryption** - encrypt logs before sending, decrypt in browser
- **Searchable** - full-text search across all log fields
- **Filterable** - by log level, channel, and namespace
- **Expandable JSON** - click to expand structured data
- **Dark/Light mode** - automatic system preference detection
- **Auto-scroll** - pauses when you scroll up, with "new logs" indicator
- **Claude Code integration** - MCP server for AI-assisted debugging (desktop app)
- **SQLite persistence** - logs stored in SQLite on server-side

## Quick Start

### 1. Start the server

```bash
# Development (from cloned repo)
pnpm install
pnpm dev
```

- API available at http://localhost:4000
- Dashboard available at http://localhost:5173

### 3. Send logs

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

## OpenTelemetry (OTLP) Support

Abbacchio natively accepts **OTLP/HTTP JSON** for logs, metrics, and traces. This means you can use any OpenTelemetry-compatible exporter — including `pino-opentelemetry-transport` — to send data to Abbacchio without installing `@abbacchio/transport`.

### Using pino-opentelemetry-transport

```bash
npm install pino pino-opentelemetry-transport
```

```typescript
import pino from 'pino';

const logger = pino({
  level: 'debug',
  transport: {
    target: 'pino-opentelemetry-transport',
    options: {
      loggerName: 'my-app',
      serviceVersion: '1.0.0',
      resourceAttributes: {
        'service.name': 'my-app',  // Used as channel in Abbacchio
      },
    },
  },
});

logger.info({ userId: 42, action: 'login' }, 'User logged in');
logger.warn({ latency: 1500 }, 'Slow response detected');
logger.error({ code: 'ERR_TIMEOUT' }, 'Connection timeout');
```

Set the environment variables before running your app:

```bash
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4000
node app.js
```

> **Important**: Use `http/json` as the protocol, not `http`. With `http` the SDK defaults to protobuf (binary), which Abbacchio does not support.

### OTLP Endpoints

| Signal  | Endpoint      | Description                    |
|---------|---------------|--------------------------------|
| Logs    | `POST /v1/logs`    | OTLP JSON log records     |
| Metrics | `POST /v1/metrics` | OTLP JSON metric data points |
| Traces  | `POST /v1/traces`  | OTLP JSON trace spans      |

The `service.name` resource attribute is used as the **channel** in Abbacchio. If not present, falls back to the `X-Channel` header or `default`.

### Switching to production observability

Since Abbacchio speaks standard OTLP, switching to a production backend is just changing one environment variable:

```bash
# Development → Abbacchio
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4000

# Production → OpenObserve, Grafana, Datadog, etc.
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-otel-collector:4318
```

No code changes required.

## High-Throughput & Agent Sandboxes

Abbacchio is optimized to handle massive amounts of logs quickly. For ephemeral environments like AI Agent Sandboxes where you don't need persistent disk storage, you can run Abbacchio entirely in-memory with strict memory bounding.

Set the following environment variables:
```bash
SQLITE_PATH=":memory:"       # Run completely in RAM (lightning fast, no disk I/O)
SQLITE_MAX_LOGS="50000"      # Strictly bounds memory size (~50MB) via O(1) rowid pruning
SQLITE_TTL_MS="1800000"      # Optional: Automatically prune logs older than 30 minutes
```
This configuration guarantees your sandbox will not hit an Out-Of-Memory (OOM) error, even if an agent spams millions of logs, while keeping ingestion speed at its absolute maximum.

## Documentation

- [OpenTelemetry](docs/opentelemetry.md) - OTLP integration and pino-opentelemetry-transport
- [Transports](docs/transports.md) - Pino, Winston, Bunyan, Console, HTTP
- [API Reference](docs/api.md) - REST endpoints and log format
- [Encryption](docs/encryption.md) - End-to-end encryption setup
- [Channels](docs/channels.md) - Multi-channel support
- [Dashboard](docs/dashboard.md) - URL parameters and filtering
- [Terminal UI](docs/tui.md) - CLI for viewing logs in terminal
- [Desktop App](docs/desktop.md) - Native app with background support
- [Claude Code](docs/claude-code.md) - AI-assisted debugging with MCP
- [Configuration](docs/configuration.md) - Environment variables
- [Development](docs/development.md) - Contributing and releasing

## License

MIT
