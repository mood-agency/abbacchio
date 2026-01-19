"""
Abbacchio - Python logging transports for Abbacchio log viewer.

Usage:
    # For stdlib logging
    from abbacchio_transport.logging import AbbacchioHandler

    # For structlog
    from abbacchio_transport.structlog import AbbacchioProcessor

    # For loguru
    from abbacchio_transport.loguru import abbacchio_sink
"""

__version__ = "0.1.0"

from abbacchio_transport.transport import AbbacchioTransport

__all__ = ["AbbacchioTransport", "__version__"]
