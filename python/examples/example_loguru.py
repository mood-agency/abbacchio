"""Example using loguru with Abbacchio."""

import sys
import time

from loguru import logger

from abbacchio.loguru import abbacchio_sink


def main():
    # Remove default handler
    logger.remove()

    # Add console output
    logger.add(sys.stderr, level="DEBUG")

    # Add Abbacchio sink
    logger.add(
        abbacchio_sink(
            url="http://localhost:4000/api/logs",
            channel="python-loguru-example",
            batch_size=5,
            flush_interval=0.5,
        ),
        format="{message}",
        level="DEBUG",
    )

    # Send some logs
    logger.debug("Application starting")
    logger.info("User logged in", user_id=123, ip="192.168.1.1")
    logger.warning("Rate limit approaching", current=95, limit=100)

    # Using bind for structured context
    request_logger = logger.bind(request_id="abc-123", user_id=456)
    request_logger.info("Processing request")
    request_logger.debug("Validating input", fields=["name", "email"])

    try:
        result = 1 / 0
    except ZeroDivisionError:
        logger.exception("Division by zero")

    logger.critical("System shutting down", reason="maintenance")

    # Give time for logs to flush
    print("\nWaiting for logs to flush...")
    time.sleep(2)
    print("Done! Check the Abbacchio dashboard.")


if __name__ == "__main__":
    main()
