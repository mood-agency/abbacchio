#!/usr/bin/env python3
"""
Script to insert test logs using loguru.

Usage: python scripts/python/insert-test-logs-loguru.py [options]
  --count <n>       Number of logs per channel (default: 5)
  --delay <ms>      Delay between logs in ms (default: 100)
  --name <name>     Log name/namespace (default: random)
  --channel <name>  Channel name(s), comma-separated (default: optimus,bumblebee,jazz)

Requires: pip install loguru
"""

import time

from loguru import logger

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

from abbacchio_transport.loguru import AbbacchioSink


def create_logger(channel: str) -> tuple[logger.__class__, AbbacchioSink, int]:
    """Create a loguru logger with Abbacchio sink for the given channel."""
    sink = AbbacchioSink(
        url=API_URL,
        channel=channel,
        batch_size=1,
        flush_interval=0.1,
    )

    # Add sink with filter to only process logs bound to this channel
    handler_id = logger.add(
        sink,
        format="{message}",
        level="DEBUG",
        filter=lambda record, ch=channel: record["extra"].get("_channel") == ch,
    )

    return logger, sink, handler_id


def log_with_level(
    log: logger.__class__, level: str, message: str, extras: dict, name: str | None
) -> None:
    """Log a message at the specified level with extras."""
    namespace = name or random_element(NAMESPACES)
    log_data = {**extras, "name": namespace}

    # Map our level names to loguru level names
    level_map = {
        "debug": "DEBUG",
        "info": "INFO",
        "warning": "WARNING",
        "error": "ERROR",
        "critical": "CRITICAL",
    }

    log.bind(**log_data).log(level_map[level], message)


def main():
    args = parse_args()
    channels = get_channels(args)

    print("Using: loguru")
    print_config(args, channels)

    # Remove default loguru handler
    logger.remove()

    sinks_and_handlers = {}
    for channel in channels:
        _, sink, handler_id = create_logger(channel)
        sinks_and_handlers[channel] = (sink, handler_id)

    try:
        for i in range(args.count):
            for channel in channels:
                level = random_element(LEVEL_NAMES)
                message = random_element(MESSAGES)
                extras = generate_random_extras(level)

                # Bind _channel for routing to correct sink
                log_with_level(logger.bind(_channel=channel), level, message, extras, args.name)
                print(f"[{channel}] Sent log #{i + 1} (level: {level})")

                if args.delay > 0:
                    time.sleep(args.delay / 1000)

        time.sleep(2)
        print("\nDone!")

    finally:
        for sink, handler_id in sinks_and_handlers.values():
            logger.remove(handler_id)
            sink.shutdown()


if __name__ == "__main__":
    main()
