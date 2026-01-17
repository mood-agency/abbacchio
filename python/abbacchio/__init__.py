"""
Abbacchio - Python logging transports for Abbacchio log viewer.

Usage:
    # For stdlib logging
    from abbacchio.logging import AbbacchioHandler

    # For structlog
    from abbacchio.structlog import AbbacchioProcessor

    # For loguru
    from abbacchio.loguru import abbacchio_sink
"""

__version__ = "0.1.0"

from abbacchio.transport import AbbacchioTransport

__all__ = ["AbbacchioTransport", "__version__"]
