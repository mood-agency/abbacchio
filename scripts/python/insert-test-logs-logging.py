#!/usr/bin/env python3
"""
Script to insert test logs using Python stdlib logging.

Usage: python scripts/python/insert-test-logs-logging.py [options]
  --count <n>       Number of logs per channel (default: 5)
  --delay <ms>      Delay between logs in ms (default: 100)
  --name <name>     Log name/namespace (default: random)
  --channel <name>  Channel name(s), comma-separated (default: optimus,bumblebee,jazz)
"""

import logging
import time

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

from abbacchio.logging import AbbacchioHandler


def create_logger(channel: str) -> logging.Logger:
    """Create a logger with Abbacchio handler for the given channel."""
    logger = logging.getLogger(f"abbacchio.{channel}")
    logger.setLevel(logging.DEBUG)
    logger.handlers.clear()

    handler = AbbacchioHandler(
        url=API_URL,
        channel=channel,
        batch_size=1,
        flush_interval=0.1,
    )
    logger.addHandler(handler)

    return logger


def log_with_level(
    logger: logging.Logger, level: str, message: str, extras: dict, name: str | None
) -> None:
    """Log a message at the specified level with extras."""
    namespace = name or random_element(NAMESPACES)
    extra_with_name = {**extras, "name": namespace}

    level_map = {
        "debug": logging.DEBUG,
        "info": logging.INFO,
        "warning": logging.WARNING,
        "error": logging.ERROR,
        "critical": logging.CRITICAL,
    }

    logger.log(level_map[level], message, extra=extra_with_name)


def main():
    args = parse_args()
    channels = get_channels(args)

    print("Using: Python stdlib logging")
    print_config(args, channels)

    loggers = {channel: create_logger(channel) for channel in channels}

    try:
        for i in range(args.count):
            for channel in channels:
                level = random_element(LEVEL_NAMES)
                message = random_element(MESSAGES)
                extras = generate_random_extras(level)

                log_with_level(loggers[channel], level, message, extras, args.name)
                print(f"[{channel}] Sent log #{i + 1} (level: {level})")

                if args.delay > 0:
                    time.sleep(args.delay / 1000)

        time.sleep(2)
        print("\nDone!")

    finally:
        for logger in loggers.values():
            for handler in logger.handlers:
                handler.close()


if __name__ == "__main__":
    main()
