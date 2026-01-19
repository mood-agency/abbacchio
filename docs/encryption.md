# End-to-End Encryption

Encryption is **built into the transports** - just add a `secretKey` option and your logs are automatically encrypted before being sent. No extra libraries needed.

## How it works

1. You add `secretKey` to your transport options (same setup as Quick Start, just add one option)
2. Logs are encrypted **in your application** before being sent to the server
3. The server only stores encrypted data - it cannot read your logs
4. The `secretKey` is **never transmitted** over the network
5. To view logs, enter the same key in the dashboard

## Enable encryption

Just add `secretKey` to your transport options:

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

## Viewing encrypted logs

1. Encrypted logs show a lock icon in the dashboard
2. Click "Set key" in the header
3. Enter the same `secretKey` used in your application

You can also pass the key via URL: `http://localhost:4000/dashboard?key=your-secret-key`

## Technical details

Encryption uses AES-256-GCM with PBKDF2 key derivation (100,000 iterations).
