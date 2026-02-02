# Claude Code Integration

Abbacchio includes an MCP (Model Context Protocol) server that enables [Claude Code](https://claude.ai/code) to query your logs directly. When you encounter an error, paste it into Claude Code and it can automatically search your logs for context, correlate events across services, and help debug issues.

## Requirements

- **Tauri Desktop App** - The MCP server reads from the native SQLite database, which is only available when using the desktop app (not the browser dashboard)
- **Claude Code** - The CLI tool from Anthropic

## How It Works

```
Your App → Abbacchio API → Centrifugo → Tauri Desktop App
                                              ↓
                                    Native SQLite (~/.abbacchio/logs.db)
                                              ↑
                                    MCP Server (reads from same DB)
                                              ↑
                                    Claude Code
```

1. Logs flow from your app through Abbacchio to the Tauri desktop app
2. The desktop app stores logs in a native SQLite database at `~/.abbacchio/logs.db`
3. The MCP server reads from this same database (using WAL mode for concurrent access)
4. Claude Code queries the MCP server to search and analyze your logs

## Setup

### 1. Use the Desktop App

The MCP integration requires the Tauri desktop app, not the browser dashboard. The browser uses isolated OPFS storage that external tools cannot access.

```bash
# Start the desktop app
pnpm dev:desktop
```

### 2. Configure Claude Code

Add the Abbacchio MCP server to your Claude Code configuration:

**~/.claude/settings.json** (or project-level `.claude/settings.json`):

```json
{
  "mcpServers": {
    "abbacchio": {
      "command": "npx",
      "args": ["@abbacchio/mcp"]
    }
  }
}
```

Or if you've installed it globally:

```json
{
  "mcpServers": {
    "abbacchio": {
      "command": "abbacchio-mcp"
    }
  }
}
```

### 3. Restart Claude Code

After updating the configuration, restart Claude Code to load the MCP server.

## Available Tools

The MCP server exposes these tools to Claude Code:

### `search_logs`

Search logs with text query and filters.

```
Parameters:
- query: Text to search in messages and data
- channel: Filter by channel/app name
- level: Minimum level (trace, debug, info, warn, error, fatal)
- from: Start timestamp (Unix ms)
- to: End timestamp (Unix ms)
- limit: Max results (default 50)
```

### `get_recent_errors`

Get recent error and fatal logs quickly.

```
Parameters:
- channel: Filter by channel/app name
- limit: Max results (default 20)
- minutes: Look back period (default 60)
```

### `get_logs_around_time`

Get logs from all channels around a specific timestamp. Useful for correlating events across services.

```
Parameters:
- timestamp: Center timestamp (Unix ms) [required]
- window: Time window in ms (default 5000)
- limit: Max results (default 100)
```

### `get_channels`

List all available log channels with statistics.

### `get_log_stats`

Get statistics about stored logs (counts by level, time range).

```
Parameters:
- channel: Filter by channel/app name
```

### `analyze_error`

Given an error message, search for related logs and provide context.

```
Parameters:
- error: The error message to analyze [required]
- channel: Filter by channel/app name
```

## Usage Examples

### Debugging a Browser Error

1. See an error in your browser console
2. Copy the error message
3. Paste into Claude Code:

```
I'm seeing this error in my browser:
TypeError: Cannot read property 'user' of undefined
    at UserProfile.render (UserProfile.tsx:42)
```

Claude Code will automatically use the `analyze_error` tool to search your logs for related events.

### Investigating a Slow Request

```
The /api/users endpoint is taking 5 seconds. Here's the request ID: abc123
Can you find what happened in the logs?
```

### Correlating Frontend and Backend

```
Users are reporting a "Payment failed" error around 2:30 PM today.
Can you find the related backend logs?
```

## Database Location

The SQLite database is stored at:

- **macOS/Linux**: `~/.abbacchio/logs.db`
- **Windows**: `%USERPROFILE%\.abbacchio\logs.db`

The database uses WAL (Write-Ahead Logging) mode, allowing the MCP server to read while the desktop app writes.

## Troubleshooting

### "Database not found"

The MCP server returns this when `~/.abbacchio/logs.db` doesn't exist. Ensure:
1. You're using the Tauri desktop app (not browser dashboard)
2. The app has received at least one log

### "No results found"

- Check that logs are flowing to the desktop app
- Verify the channel name matches
- Expand the time range or remove filters

### MCP Server Not Loading

1. Check Claude Code logs for errors
2. Verify the command path is correct
3. Try running `npx @abbacchio/mcp` directly to see if it starts

## Browser vs Desktop

| Feature | Browser Dashboard | Desktop App |
|---------|------------------|-------------|
| Log viewing | ✅ | ✅ |
| Real-time streaming | ✅ | ✅ |
| Background reception | ❌ (throttled) | ✅ |
| MCP/Claude Code | ❌ | ✅ |
| Storage location | Browser OPFS | `~/.abbacchio/logs.db` |

The browser dashboard uses OPFS (Origin Private File System) which is sandboxed and inaccessible to external tools. The desktop app uses a native SQLite file that the MCP server can read.
