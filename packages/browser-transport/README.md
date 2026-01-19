# @abbacchio/browser-transport

Browser and React logging client for Abbacchio. Intercept `console.log` and send structured logs to your Abbacchio log viewer.

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
    url: 'http://localhost:4000/api/logs',
    channel: 'my-app',
    appName: 'my-web-app',
  }
</script>
<script type="module">
  import '@abbacchio/browser-transport/auto'
</script>
```

### Option 2: Manual console interception

```javascript
import { interceptConsole, stopInterceptConsole } from '@abbacchio/browser-transport'

// Start capturing
interceptConsole({
  url: 'http://localhost:4000/api/logs',
  channel: 'my-frontend',
  appName: 'my-app',
  secretKey: 'optional-encryption-key', // optional
})

// All console methods are now captured
console.log('Captured!')
console.warn('Warning captured!')
console.error('Error captured!')

// Stop capturing when done
stopInterceptConsole()
```

### Option 3: Structured Logger

```javascript
import { createLogger } from '@abbacchio/browser-transport'

const log = createLogger({
  url: 'http://localhost:4000/api/logs',
  channel: 'my-app',
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

// Wrap your app
function App() {
  return (
    <AbbacchioProvider
      url="http://localhost:4000/api/logs"
      channel="my-react-app"
      captureConsole  // Optional: also capture console.log
    >
      <MyApp />
    </AbbacchioProvider>
  )
}

// Use in any component
function MyComponent() {
  const log = useLogger()

  const handleClick = () => {
    log.info('Button clicked', { component: 'MyComponent' })
  }

  return <button onClick={handleClick}>Click me</button>
}
```

## API Reference

### `interceptConsole(options)`

Start intercepting console methods.

```typescript
interface ConsoleInterceptorOptions {
  url?: string           // Server URL (default: 'http://localhost:4000/api/logs')
  channel?: string       // Channel name (default: 'default')
  appName?: string       // Logger name (default: 'browser')
  secretKey?: string     // Encryption key (optional)
  batchSize?: number     // Logs per batch (default: 10)
  flushInterval?: number // Ms between flushes (default: 1000)
  passthrough?: boolean  // Still log to console (default: true)
  includeUrl?: boolean   // Include page URL (default: true)
}
```

### `createLogger(options)`

Create a structured logger instance.

```typescript
interface LoggerOptions {
  url?: string
  channel?: string
  name?: string          // Logger name/namespace
  level?: number | 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  secretKey?: string
  batchSize?: number
  flushInterval?: number
}

const log = createLogger(options)

log.trace(msg, data?)
log.debug(msg, data?)
log.info(msg, data?)
log.warn(msg, data?)
log.error(msg, data?)
log.fatal(msg, data?)

// Or with data first (Pino style)
log.info({ userId: 123 }, 'User action')
```

### `AbbacchioProvider` (React)

React context provider for logging.

```tsx
<AbbacchioProvider
  url="..."
  channel="..."
  name="..."
  captureConsole={true}  // Also intercept console.log
>
  {children}
</AbbacchioProvider>
```

### `useLogger()` / `useAbbacchio()` (React Hooks)

```tsx
const log = useLogger()              // Get logger instance
const { info, warn, error } = useAbbacchio()  // Get logging methods
```

## Encryption

All options support optional end-to-end encryption:

```javascript
import { createLogger, generateKey } from '@abbacchio/browser-transport'

// Generate a key (do this once, store securely)
const key = generateKey()
console.log('Your key:', key)

// Use the key for encryption
const log = createLogger({
  channel: 'my-app',
  secretKey: key,
})

log.info('This is encrypted!')
```

The encrypted logs can only be decrypted in the Abbacchio dashboard by entering the same key.

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

## License

MIT
