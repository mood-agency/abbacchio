"""
Loguru sink for Abbacchio.

Usage:
    from loguru import logger
    from abbacchio.loguru import abbacchio_sink, AbbacchioSink

    # Option 1: Use the sink factory (recommended)
    logger.add(
        abbacchio_sink(
            url="http://localhost:4000/api/logs",
            channel="my-app",
        ),
        format="{message}",  # Formatting is handled by Abbacchio
        level="DEBUG",
    )

    # Option 2: Use the class directly
    sink = AbbacchioSink(
        url="http://localhost:4000/api/logs",
        channel="my-app",
    )
    logger.add(sink, format="{message}", level="DEBUG")

    logger.info("Hello from loguru!", user_id=123)
"""

from __future__ import annotations

import atexit
from typing import TYPE_CHECKING, Any, Callable

from abbacchio.transport import AbbacchioTransport, create_log_entry

if TYPE_CHECKING:
    from loguru import Record

# Map loguru level names to numeric levels
LEVEL_MAP = {
    "TRACE": 10,
    "DEBUG": 20,
    "INFO": 30,
    "SUCCESS": 30,  # Map SUCCESS to info
    "WARNING": 40,
    "ERROR": 50,
    "CRITICAL": 60,
}


class AbbacchioSink:
    """
    Loguru sink that sends logs to Abbacchio server.

    Args:
        url: Abbacchio server URL
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
    ):
        self._transport = AbbacchioTransport(
            url=url,
            channel=channel,
            batch_size=batch_size,
            flush_interval=flush_interval,
            timeout=timeout,
            headers=headers,
        )
        atexit.register(self.shutdown)

    def __call__(self, message: Any) -> None:
        """Handle a loguru log message."""
        record: Record = message.record

        # Extract level
        level_name = record["level"].name
        level = LEVEL_MAP.get(level_name, 30)

        # Build extra fields from record["extra"]
        extra = dict(record.get("extra", {}))

        # Remove internal routing key used for multi-channel support
        extra.pop("_channel", None)

        # Get name from extra if provided, otherwise use module name
        name = extra.pop("name", None) or record.get("name") or record["module"]

        # Add source location
        extra["file"] = record["file"].name
        extra["line"] = record["line"]
        extra["function"] = record["function"]

        # Create log entry
        entry = create_log_entry(
            level=level,
            msg=record["message"],
            name=name,
            **extra,
        )

        # Use loguru's timestamp
        entry["time"] = int(record["time"].timestamp() * 1000)

        # Handle exception info
        if record["exception"] is not None:
            exc = record["exception"]
            entry["error"] = {
                "type": exc.type.__name__ if exc.type else "Exception",
                "message": str(exc.value) if exc.value else "",
                "traceback": "".join(exc.traceback.format()) if exc.traceback else None,
            }

        self._transport.send(entry)

    def shutdown(self) -> None:
        """Shutdown the transport."""
        self._transport.shutdown()


def abbacchio_sink(
    url: str = "http://localhost:4000/api/logs",
    channel: str = "default",
    batch_size: int = 10,
    flush_interval: float = 1.0,
    timeout: float = 5.0,
    headers: dict[str, str] | None = None,
) -> Callable[[Any], None]:
    """
    Factory function to create an Abbacchio sink for loguru.

    Returns a sink callable suitable for use with logger.add().

    Example:
        logger.add(abbacchio_sink(channel="my-app"), level="DEBUG")
    """
    sink = AbbacchioSink(
        url=url,
        channel=channel,
        batch_size=batch_size,
        flush_interval=flush_interval,
        timeout=timeout,
        headers=headers,
    )
    return sink
