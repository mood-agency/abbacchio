# OpenTelemetry (OTLP) Support

Abbacchio natively accepts **OTLP/HTTP JSON** for logs, metrics, and traces. This enables integration with any OpenTelemetry-compatible exporter without needing `@abbacchio/transport`.

## OTLP Endpoints

| Signal  | Endpoint             | Content-Type       |
|---------|----------------------|--------------------|
| Logs    | `POST /v1/logs`      | `application/json` |
| Metrics | `POST /v1/metrics`   | `application/json` |
| Traces  | `POST /v1/traces`    | `application/json` |

All endpoints accept the standard [OTLP/HTTP JSON encoding](https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding) and return `200 {}` on success.

## Channel Routing

The `service.name` resource attribute is used as the **channel** in Abbacchio. Fallback order:

1. `service.name` from OTLP resource attributes
2. `X-Channel` HTTP header
3. `channel` query parameter
4. `"default"`

## Using with pino-opentelemetry-transport

[pino-opentelemetry-transport](https://github.com/pinojs/pino-opentelemetry-transport) converts Pino logs into OTLP log records and exports them via the OpenTelemetry SDK.

### Installation

```bash
npm install pino pino-opentelemetry-transport
```

### Configuration

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
        'service.name': 'my-app',  // → Abbacchio channel
      },
    },
  },
});

logger.info({ userId: 42, action: 'login' }, 'User logged in');
logger.warn({ latency: 1500 }, 'Slow response detected');
logger.error({ code: 'ERR_TIMEOUT' }, 'Connection timeout');
```

### Environment Variables

```bash
# Required: must be http/json (not http)
OTEL_EXPORTER_OTLP_PROTOCOL=http/json

# Point to your Abbacchio server
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4000
```

> **Important**: The protocol must be `http/json`. Setting it to `http` causes the SDK to use protobuf binary encoding, which Abbacchio does not support.

### How It Works

1. Pino logs are intercepted by the transport
2. The transport converts them to OTLP `LogRecord` format:
   - `msg` → `body.stringValue`
   - Pino level → OTLP `severityNumber` (e.g., info=9, warn=13, error=17)
   - Extra fields (userId, action, etc.) → OTLP `attributes`
   - `service.name` resource attribute → Abbacchio channel
3. The OpenTelemetry SDK batches and exports via `POST /v1/logs`
4. Abbacchio parses the OTLP JSON and stores logs in the buffer

### Severity Mapping

| Pino Level | Pino Number | OTLP Severity Range | OTLP Name |
|------------|-------------|----------------------|-----------|
| trace      | 10          | 1-4                  | TRACE     |
| debug      | 20          | 5-8                  | DEBUG     |
| info       | 30          | 9-12                 | INFO      |
| warn       | 40          | 13-16                | WARN      |
| error      | 50          | 17-20                | ERROR     |
| fatal      | 60          | 21-24                | FATAL     |

## Using with Any OpenTelemetry SDK

Any language's OpenTelemetry SDK can send logs, metrics, or traces to Abbacchio:

### Node.js (direct SDK)

```typescript
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { LoggerProvider, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';

const exporter = new OTLPLogExporter({
  url: 'http://localhost:4000/v1/logs',
});

const loggerProvider = new LoggerProvider();
loggerProvider.addLogRecordProcessor(new SimpleLogRecordProcessor(exporter));

const logger = loggerProvider.getLogger('my-app');
logger.emit({ body: 'Hello from OpenTelemetry SDK' });
```

### Python

```python
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter

exporter = OTLPLogExporter(endpoint="http://localhost:4000/v1/logs")
```

### cURL

```bash
curl -X POST http://localhost:4000/v1/logs \
  -H "Content-Type: application/json" \
  -d '{
    "resourceLogs": [{
      "resource": {
        "attributes": [{"key": "service.name", "value": {"stringValue": "curl-test"}}]
      },
      "scopeLogs": [{
        "logRecords": [{
          "timeUnixNano": "1700000000000000000",
          "severityNumber": 9,
          "body": {"stringValue": "Hello from cURL"}
        }]
      }]
    }]
  }'
```

## Switching to Production

Since Abbacchio uses standard OTLP, migrating to a production observability backend requires zero code changes:

```bash
# Development
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4000

# Production (OpenObserve, Grafana Tempo, Jaeger, Datadog, etc.)
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-otel-collector:4318
```

## Limitations

- Only **JSON encoding** is supported (`http/json`). Protobuf binary is not supported.
- Histograms are not yet fully supported in the metrics pipeline.
- No OTLP/gRPC support — only OTLP/HTTP.
