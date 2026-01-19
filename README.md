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

## Documentation

- [Transports](docs/transports.md) - Pino, Winston, Bunyan, Console, HTTP
- [API Reference](docs/api.md) - REST endpoints and log format
- [Encryption](docs/encryption.md) - End-to-end encryption setup
- [Channels](docs/channels.md) - Multi-channel support
- [Dashboard](docs/dashboard.md) - URL parameters and filtering
- [Terminal UI](docs/tui.md) - CLI for viewing logs in terminal
- [Desktop App](docs/desktop.md) - Native app with background support
- [Configuration](docs/configuration.md) - Environment variables
- [Development](docs/development.md) - Contributing and releasing

## License

MIT
