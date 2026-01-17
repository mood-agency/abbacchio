# Abbacchio Python

Python logging transports for [Abbacchio](https://github.com/yourusername/abbacchio) log viewer.

Supports:
- Python stdlib `logging`
- [structlog](https://www.structlog.org/)
- [loguru](https://github.com/Delgan/loguru)

## Installation

```bash
# Base package (stdlib logging only)
pip install abbacchio

# With structlog support
pip install abbacchio[structlog]

# With loguru support
pip install abbacchio[loguru]

# All optional dependencies
pip install abbacchio[all]
```

## Usage

### Python stdlib logging

```python
import logging
from abbacchio.logging import AbbacchioHandler

# Create handler
handler = AbbacchioHandler(
    url="http://localhost:4000/api/logs",
    channel="my-python-app",
)

# Add to logger
logger = logging.getLogger("my-app")
logger.addHandler(handler)
logger.setLevel(logging.DEBUG)

# Log with extra fields
logger.info("User logged in", extra={"user_id": 123, "ip": "192.168.1.1"})
logger.error("Database connection failed", exc_info=True)
```

### structlog

```python
import structlog
from abbacchio.structlog import abbacchio_processor

# Configure structlog with Abbacchio processor
structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        abbacchio_processor(
            url="http://localhost:4000/api/logs",
            channel="my-python-app",
        ),
        structlog.dev.ConsoleRenderer(),  # Keep console output
    ],
)

log = structlog.get_logger()

# Log with structured data
log.info("user.login", user_id=123, ip="192.168.1.1")
log.error("db.connection_failed", error="timeout", retry_count=3)
```

### loguru

```python
from loguru import logger
from abbacchio.loguru import abbacchio_sink

# Add Abbacchio sink
logger.add(
    abbacchio_sink(
        url="http://localhost:4000/api/logs",
        channel="my-python-app",
    ),
    format="{message}",
    level="DEBUG",
)

# Log with structured data using bind()
logger.bind(user_id=123).info("User logged in")
logger.bind(request_id="abc-123").error("Request failed")

# Or use extra in the message
logger.info("Processing order", order_id=456, total=99.99)
```

## Configuration Options

All handlers/processors accept these options:

| Option | Default | Description |
|--------|---------|-------------|
| `url` | `http://localhost:4000/api/logs` | Abbacchio server URL |
| `channel` | `default` | Channel for organizing logs |
| `batch_size` | `10` | Logs to batch before sending |
| `flush_interval` | `1.0` | Seconds between flushes |
| `timeout` | `5.0` | HTTP request timeout |
| `headers` | `None` | Additional HTTP headers |

## Encryption

To send encrypted logs, generate a key in the Abbacchio UI and pass it in headers:

```python
handler = AbbacchioHandler(
    url="http://localhost:4000/api/logs",
    channel="my-app",
    headers={"X-Encryption-Key": "your-secret-key"},
)
```

## Development

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Type check
mypy abbacchio
```

## License

MIT
