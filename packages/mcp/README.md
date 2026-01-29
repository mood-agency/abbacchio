# @abbacchio/mcp

MCP (Model Context Protocol) server for Abbacchio, enabling Claude Code to search and analyze your logs.

## Requirements

- **Tauri Desktop App** - The MCP server reads from the native SQLite database created by the desktop app
- **Claude Code** - The CLI tool from Anthropic

## Installation

```bash
npm install -g @abbacchio/mcp
# or use npx
```

## Setup

Add to your Claude Code configuration (`~/.claude/settings.json`):

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

## Available Tools

| Tool | Description |
|------|-------------|
| `search_logs` | Search logs with text query and filters |
| `get_recent_errors` | Get recent error and fatal logs |
| `get_logs_around_time` | Get logs around a timestamp for correlation |
| `get_channels` | List available log channels |
| `get_log_stats` | Get log statistics |
| `analyze_error` | Analyze an error message and find related logs |

## How It Works

1. The Abbacchio Tauri desktop app stores logs in `~/.abbacchio/logs.db`
2. This MCP server reads from that database (read-only, WAL mode)
3. Claude Code queries the MCP server to search your logs

## Usage

Paste an error into Claude Code:

```
I'm seeing this error:
TypeError: Cannot read property 'user' of undefined
```

Claude Code will automatically use the `analyze_error` tool to search your logs.

## Documentation

See [Claude Code Integration](../../docs/claude-code.md) for full documentation.
