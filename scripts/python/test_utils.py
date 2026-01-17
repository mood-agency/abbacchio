"""
Shared utilities for Python test log generation scripts.
"""

import argparse
import os
import random

API_URL = os.environ.get("API_URL", "http://localhost:4000/api/logs")

DEFAULT_CHANNELS = ["Moody Blues", "bumblebee", "jazz"]

NAMESPACES = ["auth", "api", "db", "cache", "worker", "scheduler"]

LEVEL_NAMES = ["debug", "info", "warning", "error", "critical"]

MESSAGES = [
    "Processing request",
    "Database query completed",
    "User authenticated",
    "Cache hit",
    "Cache miss",
    "Connection established",
    "Task completed successfully",
    "Retrying operation",
    "Configuration loaded",
    "Service started",
    "Webhook received",
    "Email sent",
    "File uploaded",
    "Payment processed",
    "Notification dispatched",
]

USER_IDS = ["user_001", "user_002", "user_003", "user_admin", "user_guest"]


def random_element(arr: list) -> any:
    """Return a random element from the array."""
    return random.choice(arr)


def random_request_id() -> str:
    """Generate a random request ID."""
    return f"req_{''.join(random.choices('abcdefghijklmnopqrstuvwxyz0123456789', k=8))}"


def random_duration() -> int:
    """Generate a random duration in milliseconds."""
    return random.randint(0, 2000)


def generate_random_extras(level: str) -> dict:
    """Generate random extra fields for a log entry."""
    extras = {}

    if random.random() > 0.5:
        extras["userId"] = random_element(USER_IDS)
    if random.random() > 0.5:
        extras["requestId"] = random_request_id()
    if random.random() > 0.5:
        extras["duration"] = random_duration()
    if random.random() > 0.7:
        extras["metadata"] = {
            "version": "1.0.0",
            "environment": random_element(["dev", "staging", "production"]),
            "region": random_element(["us-east-1", "eu-west-1", "ap-south-1"]),
        }
    if level in ("error", "critical") and random.random() > 0.3:
        extras["error"] = {
            "message": "Something went wrong",
            "code": random_element(
                ["ERR_TIMEOUT", "ERR_NOT_FOUND", "ERR_UNAUTHORIZED", "ERR_INTERNAL"]
            ),
            "stack": "Error: Something went wrong\n    at process (/app/index.py:42)",
        }

    return extras


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="Insert test logs into abbacchio")
    parser.add_argument(
        "--count", "-c", type=int, default=5, help="Number of logs per channel"
    )
    parser.add_argument(
        "--delay", "-d", type=int, default=100, help="Delay between logs in ms"
    )
    parser.add_argument("--name", "-n", type=str, help="Log name/namespace")
    parser.add_argument(
        "--channel",
        "-C",
        type=str,
        help="Channel name(s), comma-separated",
    )
    return parser.parse_args()


def get_channels(args: argparse.Namespace) -> list[str]:
    """Get channels from args or use defaults."""
    if args.channel:
        return [c.strip() for c in args.channel.split(",")]
    return DEFAULT_CHANNELS


def print_config(args: argparse.Namespace, channels: list[str]) -> None:
    """Print the current configuration."""
    print(f"Inserting {args.count} logs per channel ({', '.join(channels)})")
    print(f"Delay between logs: {args.delay}ms")
    print(f"API URL: {API_URL}")
    print(f"Name: {args.name or 'random'}\n")
