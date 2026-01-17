# Python Test Scripts

Test scripts for generating logs using various Python logging libraries.

## Prerequisites

### Using uv (recommended)

```bash
# Create a virtual environment
uv venv

# Activate the environment
# On Windows:
.venv\Scripts\activate
# On macOS/Linux:
source .venv/bin/activate

# Install abbacchio and dependencies
uv pip install -e ./python structlog loguru
```

### Using pip

```bash
# Create a virtual environment
python -m venv .venv

# Activate the environment
# On Windows:
.venv\Scripts\activate
# On macOS/Linux:
source .venv/bin/activate

# Install abbacchio package in development mode
pip install -e ./python

# Install optional logging libraries as needed
pip install structlog   # for structlog tests
pip install loguru      # for loguru tests
# stdlib logging is built-in
```

## Usage

```bash
# stdlib logging
python scripts/python/insert-test-logs-logging.py [options]

# structlog
python scripts/python/insert-test-logs-structlog.py [options]

# loguru
python scripts/python/insert-test-logs-loguru.py [options]
```

## Options

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--count` | `-c` | 5 | Number of logs per channel |
| `--delay` | `-d` | 100 | Delay between logs in ms |
| `--name` | `-n` | random | Log name/namespace |
| `--channel` | `-C` | optimus,bumblebee,jazz | Channel name(s), comma-separated |

## Examples

```bash
# Send 10 logs per channel with 50ms delay
python scripts/python/insert-test-logs-logging.py --count 10 --delay 50

# Send to a single channel
python scripts/python/insert-test-logs-structlog.py -c 20 -C myapp

# Send with a specific namespace
python scripts/python/insert-test-logs-loguru.py --name auth --channel app1,app2
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_URL` | `http://localhost:4000/api/logs` | Abbacchio server URL |
