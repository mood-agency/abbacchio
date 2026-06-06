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
| `--level` | `-l` | Minimum log level filter | - |

### Examples

```bash
# Basic usage
abbacchio -c my-app

# With custom API URL
abbacchio -c production -u https://logs.example.com

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

## Channel Management

The TUI stores channel configurations in a local JSON file. This allows you to:

- **Switch channels**: Press `C` to open the channel selector

### Config File Location

- **Linux/macOS**: `~/.abbacchio/tui-config.json`
- **Windows**: `C:\Users\<username>\.abbacchio\tui-config.json`
