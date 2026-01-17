"""
Python stdlib logging handler for Abbacchio.

Usage:
    import logging
    from abbacchio.logging import AbbacchioHandler

    handler = AbbacchioHandler(
        url="http://localhost:4000/api/logs",
        channel="my-app",
    )

    logger = logging.getLogger("my-app")
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)

    logger.info("Hello from Python!", extra={"user_id": 123})
"""

from __future__ import annotations

import logging
from typing import Any

from abbacchio.transport import AbbacchioTransport, create_log_entry

# Map Python logging levels to Abbacchio levels
LEVEL_MAP = {
    logging.DEBUG: 20,      # debug
    logging.INFO: 30,       # info
    logging.WARNING: 40,    # warn
    logging.ERROR: 50,      # error
    logging.CRITICAL: 60,   # fatal
}


class AbbacchioHandler(logging.Handler):
    """
    Logging handler that sends logs to Abbacchio server.

    Args:
        url: Abbacchio server URL (e.g., "http://localhost:4000/api/logs")
        channel: Channel name for organizing logs
        batch_size: Number of logs to batch before sending
        flush_interval: Seconds between flushes
        timeout: HTTP request timeout in seconds
        headers: Additional HTTP headers
    """

    def __init__(
        self,
        url: str = "http://localhost:4000/api/logs",
        channel: str = "default",
        batch_size: int = 10,
        flush_interval: float = 1.0,
        timeout: float = 5.0,
        headers: dict[str, str] | None = None,
        level: int = logging.NOTSET,
    ):
        super().__init__(level)
        self._transport = AbbacchioTransport(
            url=url,
            channel=channel,
            batch_size=batch_size,
            flush_interval=flush_interval,
            timeout=timeout,
            headers=headers,
        )

    def emit(self, record: logging.LogRecord) -> None:
        """Emit a log record."""
        try:
            # Get extra fields from record
            extra = self._extract_extra(record)

            # Create log entry
            entry = create_log_entry(
                level=LEVEL_MAP.get(record.levelno, 30),
                msg=self.format(record),
                namespace=record.name,
                **extra,
            )

            # Add exception info if present
            if record.exc_info and record.exc_info[0] is not None:
                entry["error"] = {
                    "type": record.exc_info[0].__name__,
                    "message": str(record.exc_info[1]),
                }

            self._transport.send(entry)

        except Exception:
            self.handleError(record)

    def _extract_extra(self, record: logging.LogRecord) -> dict[str, Any]:
        """Extract extra fields from log record."""
        # Standard LogRecord attributes to exclude
        standard_attrs = {
            "name", "msg", "args", "created", "filename", "funcName",
            "levelname", "levelno", "lineno", "module", "msecs",
            "pathname", "process", "processName", "relativeCreated",
            "stack_info", "exc_info", "exc_text", "thread", "threadName",
            "taskName", "message",
        }

        extra = {}
        for key, value in record.__dict__.items():
            if key not in standard_attrs and not key.startswith("_"):
                extra[key] = value

        return extra

    def close(self) -> None:
        """Close the handler and shutdown transport."""
        self._transport.shutdown()
        super().close()
