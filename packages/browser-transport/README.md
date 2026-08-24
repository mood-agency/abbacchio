# @abbacchio/browser-transport

OTLP-native browser and React logging client for Abbacchio. Intercept `console.log`, capture network requests, Web Vitals, errors, and performance metrics — all sent via OpenTelemetry protocol.

## Installation

```bash
npm install @abbacchio/browser-transport
# or
pnpm add @abbacchio/browser-transport
# or
yarn add @abbacchio/browser-transport
```

## Quick Start

### Option 1: Auto-capture (one line)

```javascript
import '@abbacchio/browser-transport/auto'

// All console.log calls now go to Abbacchio!
console.log('This is captured!')
console.error('Errors too!')
```

Configure via global variable:

```html
<script>
  window.__ABBACCHIO_CONFIG__ = {
    endpoint: 'http://localhost:4002',
    serviceName: 'my-app',
  }
</script>
<script type="module">
  import '@abbacchio/browser-transport/auto'
</script>
```

### Option 2: Manual console interception

```javascript
import { interceptConsole, stopInterceptConsole } from '@abbacchio/browser-transport'

interceptConsole({
  endpoint: 'http://localhost:4002',
  serviceName: 'my-frontend',
  appName: 'my-app',
})

console.log('Captured!')
console.warn('Warning captured!')
console.error('Error captured!')

stopInterceptConsole()
```

### Option 3: Structured Logger

```javascript
import { createLogger } from '@abbacchio/browser-transport'

const log = createLogger({
  endpoint: 'http://localhost:4002',
  serviceName: 'my-app',
  name: 'my-service',
})

log.info('User logged in', { userId: 123 })
log.warn('Rate limit approaching', { current: 95, max: 100 })
log.error('Failed to fetch', { endpoint: '/api/users', status: 500 })

// Create child logger with additional context
const requestLog = log.child({ requestId: 'abc-123' })
requestLog.info('Processing request')
```

### Option 4: React Provider

```tsx
import { AbbacchioProvider, useLogger } from '@abbacchio/browser-transport/react'

function App() {
  return (
    <AbbacchioProvider
      endpoint="http://localhost:4002"
      serviceName="my-react-app"
      captureConsole
      captureWebVitals
    >
      <MyApp />
    </AbbacchioProvider>
  )
}

function MyComponent() {
  const log = useLogger()
  return <button onClick={() => log.info('clicked')}>Click me</button>
}
```

## Web Vitals

Capture Core Web Vitals (LCP, INP, CLS, FCP, TTFB) using Google's [web-vitals](https://github.com/GoogleChrome/web-vitals) library. Each vital is reported as both a log entry and an OTLP metric gauge.

### Via Logger

```javascript
import { createLogger } from '@abbacchio/browser-transport'

const log = createLogger({
  endpoint: 'http://localhost:4002',
  serviceName: 'my-app',
  captureWebVitals: true,
})
```

### Via React Provider

```tsx
<AbbacchioProvider
  endpoint="http://localhost:4002"
  serviceName="my-app"
  captureWebVitals
>
  <App />
</AbbacchioProvider>
```

### Standalone

```javascript
import { startWebVitalsCapture, stopWebVitalsCapture } from '@abbacchio/browser-transport'

startWebVitalsCapture(
  { captureLCP: true, captureINP: true, captureCLS: true },
  (logEntry) => console.log(logEntry),
  (metric) => console.log(metric),
)
```

### Options

```typescript
interface WebVitalsCaptureOptions {
  captureLCP?: boolean     // Largest Contentful Paint (default: true)
  captureINP?: boolean     // Interaction to Next Paint (default: true)
  captureCLS?: boolean     // Cumulative Layout Shift (default: true)
  captureFCP?: boolean     // First Contentful Paint (default: true)
  captureTTFB?: boolean    // Time to First Byte (default: true)
  reportAsMetrics?: boolean // Send as OTLP metrics too (default: true)
  goodLevel?: number       // Log level for "good" ratings (default: 30/info)
  needsImprovementLevel?: number // Log level for "needs improvement" (default: 40/warn)
  poorLevel?: number       // Log level for "poor" ratings (default: 50/error)
}
```

### Output

Log entries include the vital name, value, rating, and metadata:

```
LCP 3060ms (poor)      → level: error
FCP 800ms (good)       → level: info
CLS 0.150 (needs-improvement) → level: warn
INP 120ms (good)       → level: info
TTFB 450ms (good)      → level: info
```

OTLP metrics are sent as gauges: `web_vital.lcp`, `web_vital.inp`, `web_vital.cls`, `web_vital.fcp`, `web_vital.ttfb` — each with a `rating` attribute.

## Network Capture

Automatically capture HTTP requests and WebSockets.

### Enabling at Creation

```javascript
const log = createLogger({
  endpoint: 'http://localhost:4002',
  serviceName: 'my-app',
  captureFetch: true,
  captureXhr: true,
  captureWebSockets: true,
  includeBody: false,
  ignoreNetworkUrls: ['/analytics', /\.png$/],
})
```

### Enabling at Runtime

```javascript
log.enableNetworkCapture({
  captureFetch: true,
  captureXhr: true,
  captureWebSockets: true,
})

log.disableNetworkCapture()
```

## Performance Capture

Capture main-thread jank (long tasks > 50ms) and slow event handlers via PerformanceObserver.

```javascript
import { startPerfCapture, stopPerfCapture } from '@abbacchio/browser-transport'

startPerfCapture(
  {
    captureLongTasks: true,
    captureSlowEvents: true,
    captureMemory: true,
    slowEventThresholdMs: 100,
    memoryCaptureIntervalMs: 10000,
  },
  (entry) => console.log(entry),
)
```

## Error Capture

Capture uncaught exceptions and unhandled promise rejections.

```javascript
import { startErrorCapture, stopErrorCapture } from '@abbacchio/browser-transport'

startErrorCapture(
  {
    captureErrors: true,
    captureUnhandledRejections: true,
  },
  (entry) => console.log(entry),
)
```

## OTLP Metrics & Traces

The client supports sending custom metrics and traces via the OTLP protocol.

### Metrics

```javascript
import { createLogger } from '@abbacchio/browser-transport'

const log = createLogger({ endpoint: 'http://localhost:4002', serviceName: 'my-app' })

log.metric({
  name: 'page_load_time',
  value: 1200,
  type: 'gauge',
  unit: 'ms',
  attributes: { route: '/dashboard' },
})
```

### Traces

```javascript
const span = log.startSpan('fetch-users', { route: '/api/users' })
try {
  const users = await fetchUsers()
  span.end('OK')
} catch (err) {
  span.end('ERROR')
}
```

## API Reference

### `createLogger(options)`

```typescript
interface LoggerOptions {
  endpoint?: string       // OTLP server URL (default: 'http://localhost:4002')
  serviceName?: string    // OTLP service.name attribute (default: 'default')
  name?: string           // Logger name (default: 'app')
  enabled?: boolean       // Send logs (default: true)
  level?: number | 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  batchSize?: number      // Logs per batch (default: 1000)
  flushInterval?: number  // Ms between flushes (default: 2000)
  includeUrl?: boolean    // Include page URL (default: false)

  // Web Vitals
  captureWebVitals?: boolean  // Capture LCP, INP, CLS, FCP, TTFB (default: false)
  webVitalsOptions?: WebVitalsCaptureOptions

  // Network Capture
  captureFetch?: boolean
  captureXhr?: boolean
  captureWebSockets?: boolean
  includeBody?: boolean
  includeHeaders?: boolean
  ignoreNetworkUrls?: (string | RegExp)[]
}
```

### `AbbacchioProvider` (React)

```tsx
<AbbacchioProvider
  endpoint="http://localhost:4002"
  serviceName="my-app"
  captureConsole={true}
  captureWebVitals={true}
  webVitalsOptions={{ captureLCP: true, captureINP: true }}
>
  {children}
</AbbacchioProvider>
```

### `useLogger()` / `useAbbacchio()` (React Hooks)

```tsx
const log = useLogger()
const { info, warn, error, metric, startSpan } = useAbbacchio()
```

## Disabling in Production

```javascript
const log = createLogger({
  serviceName: 'my-app',
  enabled: process.env.NODE_ENV !== 'production',
})

// Or toggle at runtime
const client = createClient({ enabled: false })
client.enable()
client.disable()
```

## Log Levels

Compatible with Pino log levels:

| Level | Number |
|-------|--------|
| trace | 10     |
| debug | 20     |
| info  | 30     |
| warn  | 40     |
| error | 50     |
| fatal | 60     |

### Filtering captured console output

`interceptConsole` and `AbbacchioProvider` accept a `level` that sets the floor
for what is **sent to the server**. `console.debug` maps to 20, `console.log` /
`console.info` to 30, `console.warn` to 40 and `console.error` to 50, so
`level: 'info'` keeps milestones and failures while dropping debug noise. Omit it
to capture every level.

Passthrough to the browser console is never suppressed by `level` — the developer
still sees everything locally.

Because `interceptConsole` merges options while capture is active, the floor can
be retuned at runtime without remounting anything:

```javascript
interceptConsole({ level: 'debug' }) // temporarily capture debug noise
interceptConsole({ level: 'info' })  // back to the shipping floor
```

## License

MIT
