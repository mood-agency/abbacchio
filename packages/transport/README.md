# @abbacchio/transport

Node.js log transports for sending logs to [Abbacchio](https://github.com/pekonchan/pino-live) - a real-time log viewer dashboard.

Supports **Pino**, **Winston**, **Bunyan**, and **Console**.

## Installation

```bash
npm install @abbacchio/transport
```

## Usage

### Pino

```typescript
import pino from "pino";

const logger = pino({
  transport: {
    targets: [
      { target: "pino-pretty" },
      {
        target: "@abbacchio/transport/transports/pino",
        options: {
          url: "http://localhost:4000/api/logs",
          channel: "my-app",
          namespace: "auth-service",
        },
      },
    ],
  },
});

logger.info({ user: "john" }, "User logged in");
```

### Winston

```typescript
import winston from "winston";
import { winstonTransport } from "@abbacchio/transport/transports/winston";

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

### Bunyan

```typescript
import bunyan from "bunyan";
import { bunyanStream } from "@abbacchio/transport/transports/bunyan";

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


### Dynamic Control (Pino)

Use `createPinoStream` for runtime control over channel, namespace, and enabled state:

```typescript
import pino from "pino";
import { createPinoStream } from "@abbacchio/transport/transports/pino";

const stream = createPinoStream({
  url: "http://localhost:4000/api/logs",
  channel: "my-app",
  namespace: "api",
  enabled: process.env.ABBACCHIO_ENABLED === "true",
});

const logger = pino(stream);

// Toggle at runtime
stream.disable(); // stop sending logs
stream.enable();  // resume sending logs

// Change namespace dynamically
stream.setNamespace("worker");
```

## Options

| Option      | Type    | Default                          | Description                                    |
| ----------- | ------- | -------------------------------- | ---------------------------------------------- |
| `url`       | string  | `http://localhost:4000/api/logs` | Abbacchio server URL                           |
| `channel`   | string  | `default`                        | Channel name for multi-app support             |
| `namespace` | string  | -                                | Default namespace (overridden by per-log values)|
| `enabled`   | boolean | `true`                           | Whether to send logs to the server             |
| `secretKey` | string  | -                                | Encryption key (enables E2E encryption)        |
| `batchSize` | number  | `10`                             | Send batch when this many logs accumulate      |
| `interval`  | number  | `1000`                           | Send batch after this many ms                  |
| `headers`   | object  | `{}`                             | Additional HTTP headers                        |

### Namespace

The `namespace` option sets a default namespace for all logs. Per-log `namespace` or `name` fields (e.g. from Pino child loggers) take precedence:

```typescript
const logger = pino({
  transport: {
    target: "@abbacchio/transport/transports/pino",
    options: { namespace: "api" },
  },
});

logger.info("hello");                           // namespace = "api"
logger.child({ name: "db" }).info("query");     // namespace = "db" (overrides)
```

### Enabled Toggle

Set `enabled: false` to prevent logs from being sent to the server. Logs are silently dropped (not buffered). All transports expose `enable()`, `disable()`, and `isEnabled()` methods for runtime control.

## End-to-End Encryption

Add `secretKey` to encrypt logs before sending:

```typescript
{
  target: "@abbacchio/transport/transports/pino",
  options: {
    url: "http://localhost:4000/api/logs",
    channel: "my-app",
    secretKey: process.env.LOG_SECRET_KEY,
  },
}
```

## License

MIT
