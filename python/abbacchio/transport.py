"""
Core transport for sending logs to Abbacchio server.
"""

from __future__ import annotations

import atexit
import queue
import threading
import time
from typing import Any
from uuid import uuid4

import httpx

# Log level mapping (matching Pino/Bunyan levels)
LEVEL_MAP = {
    "trace": 10,
    "debug": 20,
    "info": 30,
    "warning": 40,
    "warn": 40,
    "error": 50,
    "fatal": 60,
    "critical": 60,
    # Python stdlib numeric levels
    10: 20,  # DEBUG -> debug
    20: 30,  # INFO -> info
    30: 40,  # WARNING -> warn
    40: 50,  # ERROR -> error
    50: 60,  # CRITICAL -> fatal
}


class AbbacchioTransport:
    """
    HTTP transport for sending logs to Abbacchio server.

    Supports batching and async sending to minimize performance impact.

    Args:
        url: Abbacchio server URL (e.g., "http://localhost:4000/api/logs")
        channel: Channel name for organizing logs
        batch_size: Number of logs to batch before sending (default: 10)
        flush_interval: Seconds between flushes (default: 1.0)
        timeout: HTTP request timeout in seconds (default: 5.0)
        headers: Additional HTTP headers to send
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
        self.url = url
        self.channel = channel
        self.batch_size = batch_size
        self.flush_interval = flush_interval
        self.timeout = timeout

        self._headers = {"Content-Type": "application/json", "X-Channel": channel}
        if headers:
            self._headers.update(headers)

        self._queue: queue.Queue[dict[str, Any]] = queue.Queue()
        self._shutdown = threading.Event()
        self._client = httpx.Client(timeout=timeout)

        # Start background worker
        self._worker = threading.Thread(target=self._worker_loop, daemon=True)
        self._worker.start()

        # Register shutdown handler
        atexit.register(self.shutdown)

    def send(self, log: dict[str, Any]) -> None:
        """Queue a log entry for sending."""
        if not self._shutdown.is_set():
            self._queue.put(log)

    def _worker_loop(self) -> None:
        """Background worker that batches and sends logs."""
        batch: list[dict[str, Any]] = []
        last_flush = time.monotonic()

        while not self._shutdown.is_set():
            try:
                # Get log with timeout to allow periodic flush checks
                log = self._queue.get(timeout=0.1)
                batch.append(log)

                # Flush if batch is full
                if len(batch) >= self.batch_size:
                    self._flush(batch)
                    batch = []
                    last_flush = time.monotonic()

            except queue.Empty:
                # Check if we should flush based on time
                if batch and (time.monotonic() - last_flush) >= self.flush_interval:
                    self._flush(batch)
                    batch = []
                    last_flush = time.monotonic()

        # Final flush on shutdown
        if batch:
            self._flush(batch)

    def _flush(self, batch: list[dict[str, Any]]) -> None:
        """Send a batch of logs to the server."""
        if not batch:
            return

        try:
            # Wrap in {logs: [...]} to match expected API format
            self._client.post(
                self.url,
                json={"logs": batch},
                headers=self._headers,
            )
        except Exception:
            # Silently ignore errors to not disrupt the application
            pass

    def shutdown(self, timeout: float = 5.0) -> None:
        """Gracefully shutdown the transport."""
        self._shutdown.set()
        self._worker.join(timeout=timeout)
        self._client.close()

    def __enter__(self) -> "AbbacchioTransport":
        return self

    def __exit__(self, *args: Any) -> None:
        self.shutdown()


def create_log_entry(
    level: str | int,
    msg: str,
    name: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    """
    Create a log entry in Abbacchio format.

    Args:
        level: Log level (string or numeric)
        msg: Log message
        name: Optional name/namespace for the log
        **extra: Additional fields to include

    Returns:
        Dict with log entry in Abbacchio format
    """
    # Convert level to numeric
    if isinstance(level, str):
        level_num = LEVEL_MAP.get(level.lower(), 30)
    else:
        level_num = LEVEL_MAP.get(level, level)

    entry: dict[str, Any] = {
        "id": str(uuid4()),
        "level": level_num,
        "time": int(time.time() * 1000),
        "msg": msg,
    }

    if name:
        entry["name"] = name

    # Add extra fields
    if extra:
        entry.update(extra)

    return entry
