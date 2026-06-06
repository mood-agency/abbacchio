# Dashboard

## URL Parameters

Pre-configure the dashboard via URL parameters:

| Parameter | Description              | Example               |
| --------- | ------------------------ | --------------------- |
| `channel` | Pre-fill channel filter  | `?channel=api-server` |

**Examples:**

```
http://localhost:4000/dashboard?channel=api
```

## Filtering

- **Level** - Dropdown to filter by trace/debug/info/warn/error/fatal
- **Channel** - Text input to filter by channel (partial match)
- **Namespace** - Text input to filter by namespace (partial match)
- **Search** - Full-text search across message, namespace, channel, and JSON data

## Visual Indicators

- **Level badges** - Color-coded (green=info, yellow=warn, red=error, etc.)
- **Channel badges** - Cyan badges showing channel name
- **Namespace badges** - Purple badges for logger namespace
