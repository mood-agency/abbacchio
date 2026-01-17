# JavaScript Test Scripts

Test scripts for generating logs using various Node.js logging libraries.

## Prerequisites

Install the transport package and required logging libraries:

```bash
# Install the transport (from this repo or npm)
npm install @pino-live/transport

# Install logging libraries as needed
npm install pino        # for pino tests
npm install winston     # for winston tests
npm install bunyan      # for bunyan tests
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
