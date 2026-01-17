"""Tests for the core transport."""

import time
from unittest.mock import MagicMock, patch

import pytest

from abbacchio.transport import AbbacchioTransport, create_log_entry


class TestCreateLogEntry:
    def test_basic_entry(self):
        entry = create_log_entry(level="info", msg="test message")

        assert entry["level"] == 30
        assert entry["msg"] == "test message"
        assert "id" in entry
        assert "time" in entry

    def test_with_namespace(self):
        entry = create_log_entry(level="info", msg="test", namespace="my-app")

        assert entry["namespace"] == "my-app"

    def test_with_extra_fields(self):
        entry = create_log_entry(
            level="info",
            msg="test",
            user_id=123,
            action="login",
        )

        assert entry["user_id"] == 123
        assert entry["action"] == "login"

    def test_level_mapping_string(self):
        assert create_log_entry(level="trace", msg="")["level"] == 10
        assert create_log_entry(level="debug", msg="")["level"] == 20
        assert create_log_entry(level="info", msg="")["level"] == 30
        assert create_log_entry(level="warn", msg="")["level"] == 40
        assert create_log_entry(level="warning", msg="")["level"] == 40
        assert create_log_entry(level="error", msg="")["level"] == 50
        assert create_log_entry(level="fatal", msg="")["level"] == 60
        assert create_log_entry(level="critical", msg="")["level"] == 60

    def test_level_mapping_numeric(self):
        # Python logging levels
        assert create_log_entry(level=10, msg="")["level"] == 20  # DEBUG
        assert create_log_entry(level=20, msg="")["level"] == 30  # INFO
        assert create_log_entry(level=30, msg="")["level"] == 40  # WARNING
        assert create_log_entry(level=40, msg="")["level"] == 50  # ERROR
        assert create_log_entry(level=50, msg="")["level"] == 60  # CRITICAL


class TestAbbacchioTransport:
    def test_init(self):
        transport = AbbacchioTransport(
            url="http://test:4000/api/logs",
            channel="test-channel",
        )

        assert transport.url == "http://test:4000/api/logs"
        assert transport.channel == "test-channel"
        transport.shutdown()

    def test_send_queues_log(self):
        transport = AbbacchioTransport()

        entry = create_log_entry(level="info", msg="test")
        transport.send(entry)

        assert not transport._queue.empty()
        transport.shutdown()

    @patch("httpx.Client.post")
    def test_batch_flush(self, mock_post):
        transport = AbbacchioTransport(
            batch_size=2,
            flush_interval=0.1,
        )

        # Send 2 logs to trigger batch
        transport.send(create_log_entry(level="info", msg="test1"))
        transport.send(create_log_entry(level="info", msg="test2"))

        # Wait for flush
        time.sleep(0.3)

        assert mock_post.called
        transport.shutdown()

    def test_shutdown_flushes_remaining(self):
        with patch("httpx.Client.post") as mock_post:
            transport = AbbacchioTransport(
                batch_size=100,  # High batch size
                flush_interval=10.0,  # Long interval
            )

            transport.send(create_log_entry(level="info", msg="test"))
            transport.shutdown(timeout=2.0)

            # Should have flushed on shutdown
            assert mock_post.called
