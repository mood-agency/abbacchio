"""Example using structlog with Abbacchio."""

import time

import structlog

from abbacchio.structlog import abbacchio_processor


def main():
    # Configure structlog
    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            abbacchio_processor(
                url="http://localhost:4000/api/logs",
                channel="python-structlog-example",
                batch_size=5,
                flush_interval=0.5,
            ),
            structlog.dev.ConsoleRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(0),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

    log = structlog.get_logger("my-app")

    # Send some logs
    log.debug("Application starting", version="1.0.0")
    log.info("user.login", user_id=123, ip="192.168.1.1", method="oauth")
    log.warning("rate_limit.approaching", current=95, limit=100, endpoint="/api/users")

    try:
        result = 1 / 0
    except ZeroDivisionError:
        log.exception("math.error", operation="division")

    log.critical("system.shutdown", reason="maintenance", scheduled=True)

    # Give time for logs to flush
    print("\nWaiting for logs to flush...")
    time.sleep(2)
    print("Done! Check the Abbacchio dashboard.")


if __name__ == "__main__":
    main()
