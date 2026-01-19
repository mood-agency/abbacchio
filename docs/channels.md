# Multi-Channel Support

Send logs from multiple applications to the same Abbacchio server. Each app identifies itself with a channel name.

## Transport configuration

```typescript
{
  target: 'abbacchio/transports/pino',
  options: {
    url: 'http://localhost:4000/api/logs',
    channel: 'api-server'  // Logs will be tagged with this channel
  }
}
```

## HTTP header

```bash
curl -X POST http://localhost:4000/api/logs \
  -H "X-Channel: worker-service" \
  -d '{"level":30,"msg":"Processing job"}'
```

## Query parameter

```bash
curl -X POST "http://localhost:4000/api/logs?channel=cron-jobs" \
  -d '{"level":30,"msg":"Running scheduled task"}'
```

In the dashboard, a channel filter appears when multiple channels are detected.
