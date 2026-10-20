"""Regression tests for level mapping, shutdown delivery, and resilience."""

import datetime
import json
import logging
import time
from unittest.mock import MagicMock, patch

import pytest

from abbacchio_transport.logging import AbbacchioHandler
from abbacchio_transport.transport import AbbacchioTransport, create_log_entry

PINO = {"debug": 20, "info": 30, "warn": 40, "error": 50, "fatal": 60}


def _sent_bodies(mock_post):
    return [json.loads(call.kwargs["content"]) for call in mock_post.call_args_list]


class TestLevelsAreNotShiftedUp:
    """Each adapter used to pre-map to Pino ints that create_log_entry then remapped."""

    def test_stdlib_handler(self):
        handler = AbbacchioHandler()
        handler._transport.shutdown()
        handler._transport = MagicMock()
        cases = [
            (logging.DEBUG, PINO["debug"]),
            (logging.INFO, PINO["info"]),
            (logging.WARNING, PINO["warn"]),
            (logging.ERROR, PINO["error"]),
            (logging.CRITICAL, PINO["fatal"]),
        ]
        for py_level, expected in cases:
            handler.emit(logging.LogRecord("t", py_level, "p", 1, "m", (), None))
            assert handler._transport.send.call_args[0][0]["level"] == expected

    def test_loguru_sink(self):
        loguru = pytest.importorskip("loguru")
        from abbacchio_transport.loguru import AbbacchioSink

        sink = AbbacchioSink()
        sink._transport.shutdown()
        sink._transport = MagicMock()
        logger = loguru.logger
        handler_id = logger.add(sink, level="TRACE")
        try:
            for method, expected in [
                ("debug", PINO["debug"]),
                ("info", PINO["info"]),
                ("success", PINO["info"]),
                ("warning", PINO["warn"]),
                ("error", PINO["error"]),
                ("critical", PINO["fatal"]),
            ]:
                getattr(logger, method)("m")
                assert sink._transport.send.call_args[0][0]["level"] == expected, method
        finally:
            logger.remove(handler_id)

    def test_structlog_processor(self):
        pytest.importorskip("structlog")
        from abbacchio_transport.structlog import AbbacchioProcessor

        processor = AbbacchioProcessor()
        processor._transport.shutdown()
        processor._transport = MagicMock()
        for name, expected in [
            ("debug", PINO["debug"]),
            ("info", PINO["info"]),
            ("warning", PINO["warn"]),
            ("error", PINO["error"]),
            ("exception", PINO["error"]),
            ("critical", PINO["fatal"]),
        ]:
            processor(None, name, {"event": "m", "level": name})
            assert processor._transport.send.call_args[0][0]["level"] == expected, name


class TestTransportDelivery:
    def test_shutdown_delivers_everything_still_queued(self):
        with patch("httpx.Client.post") as mock_post:
            transport = AbbacchioTransport(batch_size=5, flush_interval=60.0)
            # Stop the background worker, then fill the queue as if logs had
            # piled up right before exit, and run the shutdown path directly.
            transport._shutdown.set()
            transport._worker.join(timeout=2.0)
            for i in range(12):
                transport._queue.put(create_log_entry(level="info", msg=f"m{i}"))
            transport._worker_loop()
            transport._client.close()

        sent = [log["msg"] for body in _sent_bodies(mock_post) for log in body["logs"]]
        assert sent == [f"m{i}" for i in range(12)]

    def test_unserializable_field_does_not_drop_the_batch(self):
        with patch("httpx.Client.post") as mock_post:
            transport = AbbacchioTransport(batch_size=100, flush_interval=60.0)
            transport.send(create_log_entry(level="info", msg="ok"))
            transport.send(create_log_entry(level="info", msg="has date", when=datetime.date(2026, 1, 2), obj=object()))
            transport.shutdown(timeout=2.0)

        logs = [log for body in _sent_bodies(mock_post) for log in body["logs"]]
        assert [log["msg"] for log in logs] == ["ok", "has date"]
        assert logs[1]["when"] == "2026-01-02"

    def test_queue_is_bounded_and_send_never_blocks(self):
        with patch("httpx.Client.post"):
            transport = AbbacchioTransport(max_queue_size=3)
            transport._shutdown.set()  # stop the worker from draining
            transport._worker.join(timeout=2.0)
            transport._shutdown.clear()

            start = time.monotonic()
            for i in range(10):
                transport.send(create_log_entry(level="info", msg=str(i)))
            assert time.monotonic() - start < 0.5
            assert transport._queue.qsize() == 3
            assert transport.dropped == 7
            transport._shutdown.set()
            transport._client.close()
