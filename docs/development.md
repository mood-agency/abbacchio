# Development

## Setup

```bash
# Clone the repo
git clone https://github.com/yourusername/abbacchio.git
cd abbacchio

# Install dependencies
bun install

# Run in development mode (server + dashboard hot reload)
bun run dev

# Build for production
bun run build

# Start production server
bun run start

# Run tests
bun run test

# Run tests in watch mode
bun run --filter @abbacchio/api test:watch
```

## Test Log Generator

Generate test logs to populate the dashboard during development:

```bash
bun scripts/js/insert-test-logs-pino.ts [options]
```

**Options:**

| Option    | Short | Default | Description                  |
| --------- | ----- | ------- | ---------------------------- |
| `--count` | `-c`  | `5`     | Number of logs per channel   |
| `--delay` | `-d`  | `100`   | Delay between logs in ms     |
| `--name`  | `-n`  | random  | Log name/namespace           |
| `--channel` | `-C` | 8 built-in | Channel name(s), comma-separated |

**Examples:**

```bash
# Send 5 logs per channel with 100ms delay
bun scripts/js/insert-test-logs-pino.ts

# Send 20 logs per channel with 50ms delay
bun scripts/js/insert-test-logs-pino.ts --count 20 --delay 50

# Send logs with a specific namespace
bun scripts/js/insert-test-logs-pino.ts --name my-service
```

## Releasing

All packages are versioned together and released via git tags.

### 1. Bump version

Update the version in all packages using the `/bump-version` command or manually edit:

- `package.json` (root)
- `packages/transport/package.json`
- `packages/browser-transport/package.json`
- `packages/tui/package.json`
- `packages/desktop/src-tauri/tauri.conf.json`
- `python/pyproject.toml`

### 2. Commit and tag

```bash
git add .
git commit -m "chore: bump version to 0.1.2"
git tag v0.1.2
git push origin master --tags
```

### 3. Automated releases

The tag triggers GitHub Actions workflows that automatically publish:

| Package | Registry | Install |
|---------|----------|---------|
| `@abbacchio/transport` | npm | `npm install @abbacchio/transport` |
| `@abbacchio/browser-transport` | npm | `npm install @abbacchio/browser-transport` |
| `@abbacchio/tui` | npm | `npm install -g @abbacchio/tui` |
| `abbacchio-transport` | PyPI | `pip install abbacchio-transport` |
| Desktop app | GitHub Releases | Download from releases page |

### Prerequisites for publishing

- **npm**: Set `NPM_TOKEN` secret in GitHub repository settings
- **PyPI**: Configure [Trusted Publishing](https://docs.pypi.org/trusted-publishers/) for `abbacchio-transport`
- **Desktop**: Tauri signing keys configured (optional, for auto-updates)
