# Desktop App

Native desktop application for Abbacchio, built with [Tauri](https://tauri.app/).

The desktop app maintains a persistent WebSocket connection in the Rust backend, ensuring logs are received even when the app window is minimized or in the background.

## Download

Download the latest release from the [GitHub Releases](https://github.com/yourusername/abbacchio/releases) page:

- **Windows**: `.msi` installer or `.exe`
- **macOS**: `.dmg` (Intel and Apple Silicon)
- **Linux**: `.deb`, `.rpm`, or `.AppImage`

## Why Desktop?

The web version uses a Web Worker for the WebSocket connection, but browsers throttle background tabs, causing missed logs. The Tauri desktop app solves this by:

1. Running the WebSocket connection in the Rust backend process
2. The Rust process is never throttled, regardless of window state
3. Logs are buffered and delivered to the frontend when active

### Claude Code Integration

The desktop app also enables **AI-assisted debugging** via Claude Code. Unlike the browser (which uses sandboxed OPFS storage), the desktop app stores logs in a native SQLite database at `~/.abbacchio/logs.db` that the MCP server can access.

This means you can paste an error into Claude Code and it will automatically search your logs for context. See [Claude Code Integration](claude-code.md) for setup instructions.

## Building from Source

### Prerequisites

#### 1. Install Rust

Download and install Rust from [rustup.rs](https://rustup.rs/):

**Windows:**
- Download and run `rustup-init.exe`
- Follow the installation prompts (default options are fine)
- Restart your terminal after installation

**macOS/Linux:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Verify installation:
```bash
rustc --version
cargo --version
```

#### 2. Install Build Tools

**Windows:**
- Download [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- Run the installer and select **"Desktop development with C++"**
- Restart your computer after installation

**macOS:**
```bash
xcode-select --install
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### Build

```bash
# Install dependencies
pnpm install

# Build the application
pnpm build:desktop
```

Output packages are in `packages/desktop/src-tauri/target/release/bundle/`.

### Development

```bash
pnpm dev:desktop
```

This starts the Vite dev server (port 4001), compiles the Rust backend, and opens the app with hot reload enabled.

## Troubleshooting

### "cargo: command not found"

Rust is not in your PATH. Either:
- Restart your terminal/IDE after installing Rust
- Manually add `~/.cargo/bin` (or `%USERPROFILE%\.cargo\bin` on Windows) to PATH

### Build fails with linker errors (Windows)

Visual Studio Build Tools are not installed or missing the C++ workload:
1. Run the Visual Studio Installer
2. Modify your installation
3. Ensure "Desktop development with C++" is selected

### WebView2 errors (Windows)

WebView2 runtime is required. It's included in Windows 11 and recent Windows 10 updates. If missing, download from [Microsoft WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
