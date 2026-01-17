"""Example using Python stdlib logging with Abbacchio."""

import logging
import time

from abbacchio.logging import AbbacchioHandler


def main():
    # Create handler
    handler = AbbacchioHandler(
        url="http://localhost:4000/api/logs",
        channel="python-logging-example",
        batch_size=5,
        flush_interval=0.5,
    )
    handler.setFormatter(logging.Formatter("%(message)s"))

    # Configure logger
    logger = logging.getLogger("my-app")
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)

    # Also log to console
    console = logging.StreamHandler()
    console.setFormatter(logging.Formatter("%(levelname)s - %(name)s - %(message)s"))
    logger.addHandler(console)

    # Send some logs
    logger.debug("Application starting")
    logger.info("User logged in", extra={"user_id": 123, "ip": "192.168.1.1"})
    logger.warning("Rate limit approaching", extra={"current": 95, "limit": 100})

    try:
        result = 1 / 0
    except ZeroDivisionError:
        logger.error("Division by zero", exc_info=True)

    logger.critical("System shutting down", extra={"reason": "maintenance"})

    # Give time for logs to flush
    print("\nWaiting for logs to flush...")
    time.sleep(2)
    print("Done! Check the Abbacchio dashboard.")


if __name__ == "__main__":
    main()
