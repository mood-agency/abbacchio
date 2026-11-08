# Transports

Abbacchio supports multiple logging libraries through dedicated transports.

## Common Options

All transports share these common options:

| Option               | Type    | Default                                                | Description |
| -------------------- | ------- | ------------------------------------------------------ | ----------- |
| `endpoint`           | string  | `$OTEL_EXPORTER_OTLP_ENDPOINT` or `http://localhost:4000` | Server base URL. OTLP goes to `{endpoint}/v1/{logs,metrics,traces}` |
| `serviceName`        | string  | `$OTEL_SERVICE_NAME` or `default`                     | `service.name`, used as the channel |
| `resourceAttributes` | object  | from `$OTEL_RESOURCE_ATTRIBUTES`                      | Extra resource attributes, e.g. `{ 'service.version': '1.2.3' }` |
| `headers`            | object  | from `$OTEL_EXPORTER_OTLP_HEADERS`                    | Additional HTTP headers |
| `batchSize`          | number  | `10`                                                   | Send a batch when this many records accumulate |
| `interval`           | number  | `1000`                                                 | Send a batch after this many ms |
| `enabled`            | boolean | `true` (`false` if `OTEL_SDK_DISABLED=true`)           | Whether to send anything |
| `readEnv`            | boolean | `true`                                                 | Read the `OTEL_*` variables below as defaults |
| `url`                | string  |                                                        | Deprecated: use `endpoint` |

### Standard OpenTelemetry environment variables

The Node transports fill any option you leave unset from the standard OTel SDK variables, so a program can be pointed at Abbacchio (for example `abbacchio sandbox --env-file`) and tagged with a version without code changes:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4000
export OTEL_SERVICE_NAME=shop
export OTEL_RESOURCE_ATTRIBUTES="service.version=$(git rev-parse --short HEAD),deployment.environment=ci"
export OTEL_EXPORTER_OTLP_HEADERS="x-api-key=..."   # only if the server requires a key
```

Explicit options win over the environment. `resourceAttributes` and `headers` are merged, and on conflicts the options win. Set `readEnv: false` to ignore the environment entirely. The browser transport has no environment, so configure it with options.

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
