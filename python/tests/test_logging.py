"""Tests for stdlib logging handler."""

import logging
from unittest.mock import MagicMock, patch

import pytest

from abbacchio.logging import AbbacchioHandler


class TestAbbacchioHandler:
    def test_init(self):
        handler = AbbacchioHandler(
            url="http://test:4000/api/logs",
            channel="test-channel",
        )

        assert handler._transport.url == "http://test:4000/api/logs"
        handler.close()

    @patch.object(AbbacchioHandler, "_transport", create=True)
    def test_emit_basic(self):
        handler = AbbacchioHandler()
        handler._transport = MagicMock()

        record = logging.LogRecord(
            name="test-logger",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="test message",
            args=(),
            exc_info=None,
        )

        handler.emit(record)

        handler._transport.send.assert_called_once()
        call_args = handler._transport.send.call_args[0][0]
        assert call_args["msg"] == "test message"
        assert call_args["namespace"] == "test-logger"
        assert call_args["level"] == 30  # INFO

    @patch.object(AbbacchioHandler, "_transport", create=True)
    def test_emit_with_extra(self):
        handler = AbbacchioHandler()
        handler._transport = MagicMock()

        record = logging.LogRecord(
            name="test-logger",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="test message",
            args=(),
            exc_info=None,
        )
        record.user_id = 123
        record.action = "login"

        handler.emit(record)

        call_args = handler._transport.send.call_args[0][0]
        assert call_args["user_id"] == 123
        assert call_args["action"] == "login"

    def test_level_mapping(self):
        handler = AbbacchioHandler()
        handler._transport = MagicMock()

        levels = [
            (logging.DEBUG, 20),
            (logging.INFO, 30),
            (logging.WARNING, 40),
            (logging.ERROR, 50),
            (logging.CRITICAL, 60),
        ]

        for py_level, expected in levels:
            record = logging.LogRecord(
                name="test",
                level=py_level,
                pathname="test.py",
                lineno=1,
                msg="test",
                args=(),
                exc_info=None,
            )
            handler.emit(record)

            call_args = handler._transport.send.call_args[0][0]
            assert call_args["level"] == expected

        handler.close()

    def test_integration_with_logger(self):
        with patch("httpx.Client.post"):
            handler = AbbacchioHandler(batch_size=100)
            handler._transport.send = MagicMock()

            logger = logging.getLogger("integration-test")
            logger.addHandler(handler)
            logger.setLevel(logging.DEBUG)

            logger.info("test message", extra={"key": "value"})

            handler._transport.send.assert_called()
            logger.removeHandler(handler)
            handler.close()
