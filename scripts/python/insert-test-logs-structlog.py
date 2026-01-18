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


def create_processors(channels: list[str]) -> dict[str, AbbacchioProcessor]:
    """Create Abbacchio processors for each channel."""
    processors = {}
    for channel in channels:
        processors[channel] = AbbacchioProcessor(
            url=API_URL,
            channel=channel,
            batch_size=1,
            flush_interval=0.1,
        )
    return processors


def create_routing_processor(processors: dict[str, AbbacchioProcessor]):
    """Create a processor that routes logs to the correct channel processor."""
    def routing_processor(logger, method_name, event_dict):
        # Get the channel from the bound context
        channel = event_dict.get("_channel")
        if channel and channel in processors:
            # Call the appropriate channel processor
            processors[channel](logger, method_name, event_dict)
        return event_dict
    return routing_processor


def configure_structlog(channels: list[str]) -> dict[str, AbbacchioProcessor]:
    """Configure structlog with routing to multiple channels."""
    processors = create_processors(channels)
    routing_processor = create_routing_processor(processors)

    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            routing_processor,
            structlog.dev.ConsoleRenderer(colors=False),
        ],
        wrapper_class=structlog.BoundLogger,
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=False,
    )

    return processors


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

    # Configure structlog once with all channel processors
    processors = configure_structlog(channels)

    # Get a single logger instance
    logger = structlog.get_logger()

    try:
        for i in range(args.count):
            for channel in channels:
                level = random_element(LEVEL_NAMES)
                message = random_element(MESSAGES)
                extras = generate_random_extras(level)

                # Bind _channel for routing to correct processor
                channel_logger = logger.bind(_channel=channel)
                log_with_level(channel_logger, level, message, extras, args.name)
                print(f"[{channel}] Sent log #{i + 1} (level: {level})")

                if args.delay > 0:
                    time.sleep(args.delay / 1000)

        time.sleep(2)
        print("\nDone!")

    finally:
        for processor in processors.values():
            processor.shutdown()


if __name__ == "__main__":
    main()
