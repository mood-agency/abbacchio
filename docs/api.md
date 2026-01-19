# API Reference

## POST /api/logs

Ingest logs (single or batch).

**Headers:**

- `Content-Type: application/json` (required)
- `X-Channel: <name>` (optional) - Channel identifier

**Single log:**

```json
{
  "level": 30,
  "time": 1705420800000,
  "msg": "Request completed",
  "namespace": "http",
  "req": { "method": "GET", "url": "/api/users" }
}
```

**Batch:**

```json
{
  "logs": [
    { "level": 30, "msg": "Log 1" },
    { "level": 40, "msg": "Log 2" }
  ]
}
```

**Encrypted log:**

```json
{
  "encrypted": "base64-encoded-ciphertext"
}
```

**Response:** `201 Created`

```json
{ "received": 2, "channel": "my-app" }
```

## GET /api/logs/stream

SSE endpoint for real-time logs.

**Query params:**

- `channel` - Filter by specific channel (required)

**Events:**

- `batch` - Initial batch of buffered logs
- `log` - New log entry
- `channels` - List of available channels
- `channel:added` - New channel detected
- `ping` - Keep-alive (every 15s)

## GET /api/logs

Get all buffered logs.

**Query params:**

- `channel` - Filter by specific channel (optional)

## DELETE /api/logs

Clear logs from buffer.

**Query params:**

- `channel` - Clear only specific channel (optional, default: all)

## GET /api/channels

Get list of available channels.

**Response:**

```json
{ "channels": ["default", "api-server", "worker"] }
```

## GET /api/generate-key

Generate a cryptographically secure random encryption key.

**Query params:**

- `length` - Key length in bytes (default: 32, min: 16, max: 64)

**Response:**

```json
{ "key": "Yx2kL9mN3pQ7rS1tU5vW8xZ0aB4cD6eF..." }
```

## Log Format

Abbacchio normalizes logs from different libraries:

| Field                  | Type   | Description                               |
| ---------------------- | ------ | ----------------------------------------- |
| `level`                | number | Log level (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal) |
| `time`                 | number | Unix timestamp in ms (default: now)       |
| `msg` or `message`     | string | Log message                               |
| `namespace` or `name`  | string | Logger namespace (optional)               |
| `...`                  | any    | Additional fields shown in expandable JSON|
