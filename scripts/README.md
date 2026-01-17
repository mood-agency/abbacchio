# Test Scripts

Scripts for generating test logs to verify abbacchio transports across different languages and logging libraries.

## Structure

```
scripts/
├── js/          # JavaScript/TypeScript test scripts
│   ├── pino
│   ├── winston
│   └── bunyan
└── python/      # Python test scripts
    ├── logging (stdlib)
    ├── structlog
    └── loguru
```

## Quick Start

### JavaScript

```bash
# From repo root - install all dependencies and build
pnpm install
pnpm build:transport

# Run tests
npx tsx scripts/js/insert-test-logs-pino.ts --count 10
npx tsx scripts/js/insert-test-logs-winston.ts --count 10
npx tsx scripts/js/insert-test-logs-bunyan.ts --count 10
```

### Python

```bash
# Install abbacchio package in development mode
pip install -e ./python

# Install optional logging libraries
pip install structlog loguru

# Run tests
python scripts/python/insert-test-logs-logging.py --count 10
python scripts/python/insert-test-logs-structlog.py --count 10
python scripts/python/insert-test-logs-loguru.py --count 10
```

## Common Options

All scripts share the same CLI interface:

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--count` | `-c` | 5 | Number of logs per channel |
| `--delay` | `-d` | 100 | Delay between logs in ms |
| `--name` | `-n` | random | Log name/namespace |
| `--channel` | `-C` | optimus,bumblebee,jazz | Channel name(s), comma-separated |

JavaScript scripts also support:

| Option | Short | Description |
|--------|-------|-------------|
| `--key` | `-k` | Encryption key (optional) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_URL` | `http://localhost:4000/api/logs` | Abbacchio server URL |

## Examples

```bash
# Send 20 logs to a single channel
npx tsx scripts/js/insert-test-logs-pino.ts -c 20 -C myapp
python scripts/python/insert-test-logs-logging.py -c 20 -C myapp

# Send logs with a specific namespace, slower rate
npx tsx scripts/js/insert-test-logs-winston.ts --name auth --delay 500
python scripts/python/insert-test-logs-structlog.py --name auth --delay 500

# Send to multiple channels
npx tsx scripts/js/insert-test-logs-bunyan.ts -C app1,app2,app3
python scripts/python/insert-test-logs-loguru.py -C app1,app2,app3

# Use a different server
API_URL=http://prod:4000/api/logs npx tsx scripts/js/insert-test-logs-pino.ts
```

## See Also

- [js/README.md](js/README.md) - JavaScript-specific documentation
- [python/README.md](python/README.md) - Python-specific documentation
