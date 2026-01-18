# Browser Test

A simple HTML page to test sending logs to Abbacchio from the browser.

## Usage

1. Start the Abbacchio API server:
   ```bash
   pnpm dev
   ```

2. Open `index.html` in your browser, or serve it:
   ```bash
   npx serve scripts/browser
   # Then open http://localhost:3000
   ```

3. Configure the connection settings:
   - **API URL**: The Abbacchio server endpoint (default: `http://localhost:4000/api/logs`)
   - **Channel**: The channel name for your logs
   - **Secret Key**: Optional encryption key (must match what you use in the dashboard)

4. Send logs using:
   - **Send Single Log**: Send one log with current settings
   - **Send Batch**: Send multiple logs with configurable count and delay
   - **Preset buttons**: Quick presets for common log scenarios

## Features

- Full Pino-compatible log format (level, time, name, msg, etc.)
- Optional AES-256-GCM encryption (compatible with Node.js encrypt.ts)
- Customizable log levels and extra fields
- Batch sending with configurable delay
- Preset log scenarios (user login, API request, error, performance)

## Encryption

The encryption implementation uses the Web Crypto API and is fully compatible with the Node.js `@abbacchio/client` encryption. The format is:

```
base64(salt + iv + authTag + ciphertext)
```

Where:
- Salt: 32 bytes (PBKDF2)
- IV: 16 bytes
- Auth Tag: 16 bytes
- Ciphertext: variable length

## CORS Note

If you're running the HTML file directly from the filesystem (`file://`), you may encounter CORS issues. Either:
- Serve the file with a local server (`npx serve`)
- Configure your Abbacchio API to allow CORS from all origins during development
