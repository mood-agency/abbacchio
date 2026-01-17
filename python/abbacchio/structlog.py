"""
Structlog processor for Abbacchio.

Usage:
    import structlog
    from abbacchio.structlog import AbbacchioProcessor, abbacchio_processor

    # Option 1: Use the processor factory
    processor = abbacchio_processor(
        url="http://localhost:4000/api/logs",
        channel="my-app",
    )

    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            processor,
            structlog.dev.ConsoleRenderer(),  # Keep console output
        ],
    )

    # Option 2: Use the class directly
    processor = AbbacchioProcessor(
        url="http://localhost:4000/api/logs",
        channel="my-app",
    )

    log = structlog.get_logger()
    log.info("Hello from structlog!", user_id=123)
"""

from __future__ import annotations

import atexit
from typing import Any, Callable

from abbacchio.transport import AbbacchioTransport, create_log_entry

# Map structlog level names to numeric levels
LEVEL_MAP = {
    "trace": 10,
    "debug": 20,
    "info": 30,
    "warning": 40,
    "warn": 40,
    "error": 50,
    "fatal": 60,
    "critical": 60,
    "exception": 50,
}


class AbbacchioProcessor:
    """
    Structlog processor that sends logs to Abbacchio server.

    This processor passes through all events unchanged, allowing you to
    chain it with other processors (like ConsoleRenderer).

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

    def __call__(
        self,
        logger: Any,
        method_name: str,
        event_dict: dict[str, Any],
    ) -> dict[str, Any]:
        """Process a structlog event."""
        # Extract standard fields
        level = event_dict.get("level", method_name)
        msg = event_dict.get("event", "")
        timestamp = event_dict.get("timestamp")

        # Get namespace from logger name
        namespace = None
        if hasattr(logger, "name"):
            namespace = logger.name
        elif "_logger_name" in event_dict:
            namespace = event_dict["_logger_name"]

        # Build extra fields (exclude standard structlog fields)
        exclude_keys = {"event", "level", "timestamp", "_logger_name", "_record"}
        extra = {k: v for k, v in event_dict.items() if k not in exclude_keys}

        # Create and send log entry
        entry = create_log_entry(
            level=LEVEL_MAP.get(level, 30) if isinstance(level, str) else level,
            msg=str(msg),
            namespace=namespace,
            **extra,
        )

        # Override timestamp if provided
        if timestamp:
            # Handle ISO format timestamp
            if isinstance(timestamp, str):
                try:
                    from datetime import datetime
                    dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                    entry["time"] = int(dt.timestamp() * 1000)
                except (ValueError, TypeError):
                    pass

        # Handle exception info
        if "exception" in event_dict:
            entry["error"] = {"traceback": event_dict["exception"]}
        elif "exc_info" in event_dict:
            exc_info = event_dict["exc_info"]
            if exc_info and exc_info[0] is not None:
                entry["error"] = {
                    "type": exc_info[0].__name__,
                    "message": str(exc_info[1]),
                }

        self._transport.send(entry)

        # Return event_dict unchanged to allow chaining
        return event_dict

    def shutdown(self) -> None:
        """Shutdown the transport."""
        self._transport.shutdown()


def abbacchio_processor(
    url: str = "http://localhost:4000/api/logs",
    channel: str = "default",
    batch_size: int = 10,
    flush_interval: float = 1.0,
    timeout: float = 5.0,
    headers: dict[str, str] | None = None,
) -> Callable[[Any, str, dict[str, Any]], dict[str, Any]]:
    """
    Factory function to create an Abbacchio processor.

    Returns a processor function suitable for use in structlog.configure().
    """
    processor = AbbacchioProcessor(
        url=url,
        channel=channel,
        batch_size=batch_size,
        flush_interval=flush_interval,
        timeout=timeout,
        headers=headers,
    )
    return processor
