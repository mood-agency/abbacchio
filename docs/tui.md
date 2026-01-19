# Terminal UI (TUI)

Terminal user interface for Abbacchio. Connects via WebSocket and displays logs in the terminal with colors, filtering, and keyboard navigation.

## Installation

```bash
npm install -g @abbacchio/tui
```

## Usage

```bash
abbacchio -c <channel>
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
abbacchio -c my-app

# With custom API URL
abbacchio -c production -u https://logs.example.com

# With encryption key (will be saved for future sessions)
abbacchio -c secure-channel -k mySecretKey123

# Filter by level (only show warn and above)
abbacchio -c my-app -l warn
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
| `C` | Open channel selector |
| `?` | Show help |
| `Esc` | Clear filters / Go back |

## Channel & Key Management

The TUI stores channel configurations and encryption keys in a local JSON file. This allows you to:

- **Remember encryption keys**: Once you provide a key via CLI (`-k`), it's saved and automatically used next time
- **Switch channels**: Press `C` to open the channel selector
- **Update keys**: When switching channels, you can view/edit the stored key

### Config File Location

- **Linux/macOS**: `~/.abbacchio/tui-config.json`
- **Windows**: `C:\Users\<username>\.abbacchio\tui-config.json`

### How it works

1. First time connecting to an encrypted channel:
   ```bash
   abbacchio -c my-channel -k mySecretKey123
   ```
   The key is saved to the config.

2. Subsequent connections:
   ```bash
   abbacchio -c my-channel
   ```
   The stored key is automatically loaded.

3. To change a key, press `C` to open the channel selector, select the channel, and enter the new key.
