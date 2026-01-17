# Security Guide for Abbacchio

This document describes security features and best practices for deploying Abbacchio in production.

## Overview

Abbacchio includes multiple layers of security:
- **Dashboard**: Master password encryption for stored channel configurations
- **API**: Authentication, rate limiting, and connection limits
- **Transport**: End-to-end encryption for log data

## Dashboard Security

### Master Password System

Channel configurations (including encryption keys) are encrypted in the browser using AES-256-GCM with a master password.

**How it works:**
1. On first use, users create a master password (min 8 characters)
2. Channel configs are encrypted with PBKDF2-derived key (100,000 iterations)
3. Encrypted data is stored in localStorage
4. On page load, users must enter the master password to unlock

**Memory-only mode:**
Users can choose not to persist channels. In this mode:
- Channels are only stored in memory
- Data is lost when the browser tab closes
- Useful for temporary debugging sessions

### URL Parameter Security

**REMOVED:** The `?key=` URL parameter is no longer supported. Encryption keys must be entered manually through the UI to prevent:
- Keys appearing in browser history
- Keys leaking via HTTP Referer headers
- Keys being logged by proxies/firewalls
- Accidental sharing of URLs containing keys

The `?channel=` parameter is still supported for convenience.

## API Security

### Authentication

Set the `API_KEY` environment variable to require authentication:

```bash
API_KEY=your-secure-random-key
```

In production (`NODE_ENV=production`), the API will:
- Require `API_KEY` to be set
- Reject all requests without valid authentication
- Return 503 if `API_KEY` is not configured

**Sending the API key:**
- Header: `X-API-KEY: your-key`
- Query param: `?apiKey=your-key`

### CORS Configuration

```bash
# Development (default): allows all origins
CORS_ORIGIN=*

# Production: specify allowed origin
CORS_ORIGIN=https://your-dashboard.com
```

In production without explicit CORS_ORIGIN, defaults to `http://localhost:4001`.

### Rate Limiting

Enabled by default. Configure with:

```bash
ENABLE_RATE_LIMIT=true           # Enable/disable (default: true)
RATE_LIMIT_WINDOW=60000          # Window in ms (default: 60s)
RATE_LIMIT_MAX=1000              # Max requests per window (default: 1000)
```

### Connection Limits

Prevents DoS attacks by limiting connections:

```bash
MAX_CONNECTIONS=1000             # Total max SSE connections
MAX_CONNECTIONS_PER_IP=10        # Max connections per IP address
CONNECTION_TIMEOUT=3600000       # Connection timeout in ms (1 hour)
```

### Proxy Configuration

**IMPORTANT:** Proxy headers (`x-forwarded-for`, `x-real-ip`) are NOT trusted by default.

```bash
# Only enable if behind a trusted reverse proxy
TRUST_PROXY=true
```

Without `TRUST_PROXY=true`:
- Rate limiting uses a hash-based client identifier
- Connection limits use a generic identifier
- IP-based features may be less effective

### Security Headers

The following headers are automatically added in production:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy: default-src 'self'; ...`
- `Strict-Transport-Security: max-age=31536000` (when HTTPS)

## Encryption

### Log Encryption

Logs can be encrypted end-to-end using the transport's encryption feature:

```javascript
// In your application
const transport = pino.transport({
  target: '@abbacchio/transport',
  options: {
    url: 'http://localhost:4000/api/logs',
    secretKey: 'your-encryption-key',  // Enables AES-256-GCM encryption
  }
});
```

**Note:** The server uses scrypt for key derivation, while the browser uses PBKDF2 for compatibility. Both use the same encryption algorithm (AES-256-GCM).

## Production Deployment Checklist

1. **Set required environment variables:**
   ```bash
   NODE_ENV=production
   API_KEY=<generate-secure-random-key>
   CORS_ORIGIN=https://your-domain.com
   ```

2. **Deploy behind HTTPS:**
   - Use a reverse proxy (nginx, Cloudflare, etc.)
   - Set `TRUST_PROXY=true` if using a reverse proxy

3. **Configure rate limits appropriately:**
   ```bash
   RATE_LIMIT_MAX=100              # Adjust based on expected traffic
   MAX_CONNECTIONS_PER_IP=5        # Lower for public deployments
   ```

4. **Monitor logs:**
   - Watch for 429 (rate limit) responses
   - Watch for 401 (unauthorized) responses

## Example .env File

```bash
# Production settings
NODE_ENV=production

# Security
API_KEY=your-secure-api-key-here
CORS_ORIGIN=https://your-dashboard.com
TRUST_PROXY=true

# Rate limiting
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX=100

# Connection limits
MAX_CONNECTIONS=1000
MAX_CONNECTIONS_PER_IP=5
CONNECTION_TIMEOUT=1800000

# Server
PORT=4000
```

## Reporting Security Issues

If you discover a security vulnerability, please report it responsibly by contacting the maintainers directly rather than opening a public issue.
