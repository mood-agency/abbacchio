# Transports

Abbacchio supports multiple logging libraries through dedicated transports.

## Common Options

All transports share these common options:

| Option      | Type   | Default                          | Description                            |
| ----------- | ------ | -------------------------------- | -------------------------------------- |
| `url`       | string | `http://localhost:4000/api/logs` | Abbacchio server URL                   |
| `channel`   | string | `default`                        | Channel name for multi-app support     |
| `secretKey` | string | -                                | Encryption key (enables E2E encryption)|
| `batchSize` | number | `10`                             | Send batch when this many logs accumulate |
| `interval`  | number | `1000`                           | Send batch after this many ms          |
| `headers`   | object | `{}`                             | Additional HTTP headers                |

## Pino

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

### With encryption

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

## Winston

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

### Winston-specific options

```typescript
import { winstonTransport } from "abbacchio/transports/winston";

const transport = winstonTransport({
  url: "http://localhost:4000/api/logs",
  channel: "api-server",
  level: "debug", // Winston log level filter
});
```

## Bunyan

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

### Bunyan-specific options

```typescript
import { bunyanStream } from "abbacchio/transports/bunyan";

const stream = bunyanStream({
  url: "http://localhost:4000/api/logs",
  channel: "api-server",
  level: "debug", // Bunyan log level filter
});
```

## Console

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

### Console-specific options

```typescript
import { interceptConsole } from "abbacchio/transports/console";

interceptConsole({
  url: "http://localhost:4000/api/logs",
  channel: "browser-app",
  methods: ["log", "warn", "error"], // Which methods to intercept
  passthrough: true, // Also output to original console
});
```

## HTTP (curl/fetch)

### Using curl

```bash
curl -X POST http://localhost:4000/api/logs \
  -H "Content-Type: application/json" \
  -H "X-Channel: my-app" \
  -d '{"level":30,"msg":"Hello from curl"}'
```

### Using fetch

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
