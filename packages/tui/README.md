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

# With encryption key (will be saved for future sessions)
pnpm tui -c secure-channel -k mySecretKey123

# Filter by level (only show warn and above)
pnpm tui -c my-app -l warn
```

## Channel & Key Management

The TUI stores channel configurations and encryption keys in a local JSON file at `~/.abbacchio/tui-config.json`. This allows you to:

- **Remember encryption keys**: Once you provide a key via CLI (`-k`), it's saved and automatically used next time
- **Switch channels**: Press `C` to open the channel selector
- **Update keys**: When switching channels, you can view/edit the stored key

### How it works

1. First time connecting to an encrypted channel:
   ```bash
   pnpm tui -c my-channel -k mySecretKey123
   ```
   The key is saved to the database.

2. Subsequent connections:
   ```bash
   pnpm tui -c my-channel
   ```
   The stored key is automatically loaded.

3. To change a key, press `C` to open the channel selector, select the channel, and enter the new key.

### Config File Location

- **Linux/macOS**: `~/.abbacchio/tui-config.json`
- **Windows**: `C:\Users\<username>\.abbacchio\tui-config.json`

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
| `C` | Open channel selector |
| `?` | Show help |
| `Esc` | Clear filters / Go back |

## Architecture

```
src/
├── cli.ts                # CLI entry point (meow)
├── index.tsx             # Ink render entry
├── App.tsx               # Main component
├── components/
│   ├── Header.tsx        # Channel, status, log count
│   ├── LogList.tsx       # Scrollable log list
│   ├── LogRow.tsx        # Individual log with colors
│   ├── FilterBar.tsx     # Level filter, search
│   ├── StatusBar.tsx     # Keyboard shortcuts
│   ├── HelpOverlay.tsx   # Full help screen
│   └── ChannelSelector.tsx # Channel/key management UI
├── hooks/
│   ├── useCentrifugo.ts  # Centrifugo WebSocket connection
│   ├── useLogStore.ts    # Log state and filtering
│   ├── useKeyBindings.ts # Keyboard input
│   └── useChannelConfig.ts # Channel config persistence
├── lib/
│   ├── colors.ts         # Level colors (chalk)
│   ├── crypto.ts         # AES-256-GCM decryption
│   └── storage.ts        # JSON file storage for config
└── types/
    └── index.ts          # TypeScript types
```

## Dependencies

- **ink** - React for CLI
- **react** - UI framework
- **meow** - CLI argument parsing
- **centrifuge** - Centrifugo client for WebSocket
- **ws** - WebSocket implementation for Node.js
- **chalk** - Terminal colors
- **ink-text-input** - Text input component
- **ink-select-input** - Select/dropdown component

## Connection Flow

```
1. TUI fetches token from API: GET /api/centrifugo/token
2. TUI connects directly to Centrifugo: ws://localhost:8000/connection/websocket
3. TUI subscribes to channel: logs:{channelName}
4. Logs are received in real-time via WebSocket
```

This is the same connection flow used by the Dashboard and Tauri app.

## Data Storage

The TUI uses a JSON file for local persistence at `~/.abbacchio/tui-config.json`:

```json
{
  "channels": [
    {
      "name": "my-channel",
      "secretKey": "encryption-key-here",
      "createdAt": 1705123456789,
      "lastUsedAt": 1705123456789
    }
  ]
}
```

Each channel entry stores:
- **name**: Channel name (unique identifier)
- **secretKey**: Encryption key for decrypting logs
- **createdAt**: Unix timestamp when channel was first added
- **lastUsedAt**: Unix timestamp of last access (used for sorting)
