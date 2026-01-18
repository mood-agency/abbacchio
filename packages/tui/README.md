# @abbacchio/tui

Terminal user interface for the Abbacchio real-time log viewer. Connects to Centrifugo via WebSocket (same as Dashboard) and displays logs in the terminal with colors, filtering, and keyboard navigation.

## Installation

```bash
# From the monorepo root
pnpm install
```

## Building

```bash
# Build only the TUI package
pnpm build:tui

# Or from packages/tui
cd packages/tui
pnpm build
```

## Usage

### Development (with hot reload)

```bash
# From monorepo root
pnpm tui -c <channel>

# Or directly
cd packages/tui
pnpm dev -- -c <channel>

# Using npx
npx tsx src/cli.ts -c <channel>
```

### Production (after build)

```bash
cd packages/tui
node dist/cli.js -c <channel>
```

## CLI Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--channel` | `-c` | Channel name (required) | - |
| `--api-url` | `-u` | API server URL | `http://localhost:4000` |
| `--key` | `-k` | Decryption key for encrypted logs | - |
| `--level` | `-l` | Minimum log level filter | - |

### Examples

```bash
# Basic usage
pnpm tui -c my-app

# With custom API URL
pnpm tui -c production -u https://logs.example.com

# With encryption key
pnpm tui -c secure-channel -k mySecretKey123

# Filter by level (only show warn and above)
pnpm tui -c my-app -l warn
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `q` | Quit |
| `p` / `Space` | Pause/Resume log stream |
| `j` / `↓` | Scroll down |
| `k` / `↑` | Scroll up |
| `g` | Go to top |
| `G` | Go to bottom |
| `/` | Search logs |
| `1` | Filter: trace+ |
| `2` | Filter: debug+ |
| `3` | Filter: info+ |
| `4` | Filter: warn+ |
| `5` | Filter: error+ |
| `6` | Filter: fatal only |
| `0` | Show all levels |
| `c` | Clear logs |
| `?` | Show help |
| `Esc` | Clear filters |

## Architecture

```
src/
├── cli.ts              # CLI entry point (meow)
├── index.tsx           # Ink render entry
├── App.tsx             # Main component
├── components/
│   ├── Header.tsx      # Channel, status, log count
│   ├── LogList.tsx     # Scrollable log list
│   ├── LogRow.tsx      # Individual log with colors
│   ├── FilterBar.tsx   # Level filter, search
│   ├── StatusBar.tsx   # Keyboard shortcuts
│   └── HelpOverlay.tsx # Full help screen
├── hooks/
│   ├── useCentrifugo.ts  # Centrifugo WebSocket connection
│   ├── useLogStore.ts    # Log state and filtering
│   └── useKeyBindings.ts # Keyboard input
├── lib/
│   ├── colors.ts       # Level colors (chalk)
│   └── crypto.ts       # AES-256-GCM decryption
└── types/
    └── index.ts        # TypeScript types
```

## Dependencies

- **ink** - React for CLI
- **react** - UI framework
- **meow** - CLI argument parsing
- **centrifuge** - Centrifugo client for WebSocket
- **ws** - WebSocket implementation for Node.js
- **chalk** - Terminal colors

## Connection Flow

```
1. TUI fetches token from API: GET /api/centrifugo/token
2. TUI connects directly to Centrifugo: ws://localhost:8000/connection/websocket
3. TUI subscribes to channel: logs:{channelName}
4. Logs are received in real-time via WebSocket
```

This is the same connection flow used by the Dashboard and Tauri app.
