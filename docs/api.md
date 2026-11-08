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

**Response:** `201 Created`

```json
{ "received": 2, "channel": "my-app" }
```

## GET /api/logs

Get buffered logs, with optional polling support.

**Query params:**

- `channel` - Filter by specific channel (optional)
- `afterId` - Return only logs after this ID (for incremental polling)

**Response:**

```json
{
  "logs": [
    {
      "id": "abc123",
      "level": 30,
      "levelLabel": "info",
      "time": 1705420800000,
      "msg": "Request completed",
      "channel": "my-app",
      "data": {}
    }
  ]
}
```

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

## GET /api/versions

List the `service.version` values seen per channel, with span, metric-point and log counts. Optional `channel` query param.

```json
{ "versions": [{ "channel": "shop", "version": "1.1.0", "spans": 1000, "metricPoints": 12, "logs": 40, "firstSeen": 1794110521059, "lastSeen": 1794110522158 }] }
```

## GET /api/compare

Compare a span or metric between two runs (for example a baseline version and a candidate version). It returns mean, p50, p90, p95, p99 and max for each run, the deltas, and a verdict: `regression`, `improvement`, `no_change` or `insufficient_data`.

```bash
curl 'http://localhost:4000/api/compare?source=span&name=checkout&baselineVersion=1.0.0&candidateVersion=1.1.0'
```

See [Comparing Versions](performance-comparison.md) for every parameter and how values are computed.

## POST /api/sql

Execute SQL queries against stored logs.

**Body:**

```json
{ "query": "SELECT * FROM logs WHERE level >= 50 LIMIT 10" }
```

**Response:**

```json
{
  "columns": ["id", "level", "msg", "channel", "time"],
  "rows": [...],
  "rowCount": 10,
  "executionTimeMs": 5
}
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
