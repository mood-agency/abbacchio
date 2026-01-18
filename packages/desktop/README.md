# Abbacchio Desktop

Native desktop application for Abbacchio log viewer, built with [Tauri](https://tauri.app/).

The desktop app maintains a persistent WebSocket connection to Centrifugo in the Rust backend, ensuring logs are received even when the app window is minimized or in the background.

## Prerequisites

### 1. Install Rust

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

### 2. Install Build Tools

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

### 3. Install Node.js Dependencies

From the project root:
```bash
pnpm install
```

## Development

### Quick Start

If Rust/Cargo is in your PATH:
```bash
pnpm dev:desktop
```

### If Cargo is not in PATH (Windows PowerShell)

Add Cargo to your current session:
```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
pnpm dev:desktop
```

Or permanently add to PATH:
1. Open "Edit environment variables for your account"
2. Edit the `PATH` variable
3. Add: `%USERPROFILE%\.cargo\bin`
4. Restart your terminal

### What happens during development

1. Vite dev server starts for the dashboard (port 4001)
2. Tauri compiles the Rust backend
3. The app window opens, loading the dashboard from the dev server
4. Hot reload is enabled for frontend changes

## Building for Production

### Build the Application

```bash
pnpm build:desktop
```

This creates distributable packages in `packages/desktop/src-tauri/target/release/bundle/`:

- **Windows:** `.msi` installer and `.exe`
- **macOS:** `.dmg` and `.app`
- **Linux:** `.deb`, `.rpm`, and `.AppImage`

### Build for Specific Platform

```bash
# From packages/desktop directory
pnpm tauri build --target x86_64-pc-windows-msvc  # Windows
pnpm tauri build --target x86_64-apple-darwin     # macOS Intel
pnpm tauri build --target aarch64-apple-darwin    # macOS Apple Silicon
pnpm tauri build --target x86_64-unknown-linux-gnu # Linux
```

## Project Structure

```
packages/desktop/
├── package.json              # Node.js dependencies (Tauri CLI)
├── src-tauri/
│   ├── Cargo.toml           # Rust dependencies
│   ├── tauri.conf.json      # Tauri configuration
│   ├── build.rs             # Build script
│   ├── capabilities/
│   │   └── default.json     # App permissions
│   ├── icons/               # App icons (all sizes)
│   └── src/
│       ├── main.rs          # App entry point
│       └── centrifugo.rs    # WebSocket connection handler
```

## Architecture

```
┌─────────────────────────────────────────┐
│  Rust Backend (always active)           │
│  ├── WebSocket connection to Centrifugo │
│  ├── Receives logs in background        │
│  └── Sends to frontend via Tauri Events │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│  WebView (React frontend)               │
│  ├── Same codebase as web dashboard     │
│  ├── Listens to Tauri Events            │
│  └── Stores logs in SQLite (WASM)       │
└─────────────────────────────────────────┘
```

### Why Tauri?

The web version uses a Web Worker for the WebSocket connection, but browsers throttle background tabs, causing missed logs. The Tauri desktop app solves this by:

1. Running the WebSocket connection in the Rust backend process
2. The Rust process is never throttled, regardless of window state
3. Logs are buffered and delivered to the frontend when active

## Configuration

### Tauri Settings

Edit `src-tauri/tauri.conf.json`:

```json
{
  "productName": "Abbacchio",
  "version": "0.1.0",
  "app": {
    "windows": [{
      "title": "Abbacchio",
      "width": 1200,
      "height": 800
    }]
  }
}
```

### App Icons

Replace icons in `src-tauri/icons/` with your own. Generate all sizes from a single 1024x1024 PNG:

```bash
cd packages/desktop/src-tauri
npx tauri icon path/to/your-icon.png
```

## Troubleshooting

### "cargo: command not found"

Rust is not in your PATH. Either:
- Restart your terminal/IDE after installing Rust
- Manually add `~/.cargo/bin` (or `%USERPROFILE%\.cargo\bin` on Windows) to PATH

### "failed to run 'cargo metadata'"

Same as above - Cargo is not in PATH.

### Build fails with linker errors (Windows)

Visual Studio Build Tools are not installed or missing the C++ workload:
1. Run the Visual Studio Installer
2. Modify your installation
3. Ensure "Desktop development with C++" is selected

### WebView2 errors (Windows)

WebView2 runtime is required. It's included in Windows 11 and recent Windows 10 updates. If missing:
- Download from [Microsoft WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

## License

MIT
