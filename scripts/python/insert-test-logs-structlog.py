#!/usr/bin/env python3
"""
Script to insert test logs using structlog.

Usage: python scripts/python/insert-test-logs-structlog.py [options]
  --count <n>       Number of logs per channel (default: 5)
  --delay <ms>      Delay between logs in ms (default: 100)
  --name <name>     Log name/namespace (default: random)
  --channel <name>  Channel name(s), comma-separated (default: optimus,bumblebee,jazz)

Requires: pip install structlog
"""

import time

import structlog

from test_utils import (
    API_URL,
    LEVEL_NAMES,
    MESSAGES,
    NAMESPACES,
    generate_random_extras,
    get_channels,
    parse_args,
    print_config,
    random_element,
)

from abbacchio.structlog import AbbacchioProcessor


def create_logger(channel: str) -> tuple[structlog.BoundLogger, AbbacchioProcessor]:
    """Create a structlog logger with Abbacchio processor for the given channel."""
    processor = AbbacchioProcessor(
        url=API_URL,
        channel=channel,
        batch_size=1,
        flush_interval=0.1,
    )

    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            processor,
            structlog.dev.ConsoleRenderer(colors=False),
        ],
        wrapper_class=structlog.BoundLogger,
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=False,
    )

    logger = structlog.get_logger(channel)
    return logger, processor


def log_with_level(
    logger: structlog.BoundLogger, level: str, message: str, extras: dict, name: str | None
) -> None:
    """Log a message at the specified level with extras."""
    namespace = name or random_element(NAMESPACES)
    log_data = {**extras, "name": namespace}

    level_methods = {
        "debug": logger.debug,
        "info": logger.info,
        "warning": logger.warning,
        "error": logger.error,
        "critical": logger.critical,
    }

    level_methods[level](message, **log_data)


def main():
    args = parse_args()
    channels = get_channels(args)

    print("Using: structlog")
    print_config(args, channels)

    loggers_and_processors = {channel: create_logger(channel) for channel in channels}

    try:
        for i in range(args.count):
            for channel in channels:
                level = random_element(LEVEL_NAMES)
                message = random_element(MESSAGES)
                extras = generate_random_extras(level)

                logger, _ = loggers_and_processors[channel]
                log_with_level(logger, level, message, extras, args.name)
                print(f"[{channel}] Sent log #{i + 1} (level: {level})")

                if args.delay > 0:
                    time.sleep(args.delay / 1000)

        time.sleep(2)
        print("\nDone!")

    finally:
        for _, processor in loggers_and_processors.values():
            processor.shutdown()


if __name__ == "__main__":
    main()
