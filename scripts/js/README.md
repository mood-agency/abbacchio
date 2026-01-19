# JavaScript Test Scripts

Test scripts for generating logs using various Node.js logging libraries.

## Prerequisites

From the repo root:

```bash
# Install all dependencies (includes pino, winston, bunyan)
pnpm install

# Build the transport package
pnpm build:transport
```

## Usage

```bash
# Pino
npx tsx scripts/js/insert-test-logs-pino.ts [options]

# Winston
npx tsx scripts/js/insert-test-logs-winston.ts [options]

# Bunyan
npx tsx scripts/js/insert-test-logs-bunyan.ts [options]
```

## Testing npm Package

To test the `@abbacchio/transport` package directly from npm (without using the local build):

```bash
npx tsx scripts/js/test-npm-package.ts [options]
```

This script creates a temporary directory, installs the package from npm, and runs a test.

### npm Package Test Options

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--version` | `-v` | latest | Package version to install |
| `--count` | `-c` | 5 | Number of logs to send |
| `--delay` | `-d` | 100 | Delay between logs in ms |
| `--channel` | `-C` | npm-test | Channel name |
| `--keep` | `-k` | false | Keep temp directory after test |

### npm Package Test Examples

```bash
# Test latest version
npx tsx scripts/js/test-npm-package.ts

# Test specific version
npx tsx scripts/js/test-npm-package.ts --version 0.1.2

# Send more logs and keep temp dir for inspection
npx tsx scripts/js/test-npm-package.ts --count 20 --keep

# Test with custom channel
npx tsx scripts/js/test-npm-package.ts --channel my-test-channel
```

## Options

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--count` | `-c` | 5 | Number of logs per channel |
| `--delay` | `-d` | 100 | Delay between logs in ms |
| `--key` | `-k` | - | Encryption key (optional) |
| `--name` | `-n` | random | Log name/namespace |
| `--channel` | `-C` | optimus,bumblebee,jazz | Channel name(s), comma-separated |

## Examples

```bash
# Send 10 logs per channel with 50ms delay
npx tsx scripts/js/insert-test-logs-pino.ts --count 10 --delay 50

# Send to a single channel
npx tsx scripts/js/insert-test-logs-winston.ts -c 20 -C myapp

# Send with a specific namespace
npx tsx scripts/js/insert-test-logs-bunyan.ts --name auth --channel app1,app2
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_URL` | `http://localhost:4000/api/logs` | Abbacchio server URL |
