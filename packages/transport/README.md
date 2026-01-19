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

### Console

```typescript
import { interceptConsole, restoreConsole } from "@abbacchio/transport/transports/console";

interceptConsole({
  url: "http://localhost:4000/api/logs",
  channel: "my-app",
  passthrough: true,
});

console.log("This will be sent to Abbacchio!");

restoreConsole();
```

## Options

| Option      | Type   | Default                          | Description                             |
| ----------- | ------ | -------------------------------- | --------------------------------------- |
| `url`       | string | `http://localhost:4000/api/logs` | Abbacchio server URL                    |
| `channel`   | string | `default`                        | Channel name for multi-app support      |
| `secretKey` | string | -                                | Encryption key (enables E2E encryption) |
| `batchSize` | number | `10`                             | Send batch when this many logs accumulate |
| `interval`  | number | `1000`                           | Send batch after this many ms           |
| `headers`   | object | `{}`                             | Additional HTTP headers                 |

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
