"""Shared fixtures for Search & Discover backend tests."""

from __future__ import annotations

import socket
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = REPO_ROOT / "apps" / "engine" / "backend"
FIXTURES_ROOT = REPO_ROOT / "tests" / "search" / "fixtures"


def pytest_addoption(parser):
    parser.addoption("--run-browser", action="store_true", help="Run offline Chromium integration tests")


def pytest_collection_modifyitems(config, items):
    if not config.getoption("--run-browser"):
        for item in items:
            if "browser" in item.keywords:
                item.add_marker(pytest.mark.skip(reason="enable offline Chromium tests with --run-browser"))

sys.path.insert(0, str(BACKEND_ROOT))


@pytest.fixture
def provider_fixtures() -> Path:
    return FIXTURES_ROOT / "provider"


@pytest.fixture
def html_fixtures() -> Path:
    return FIXTURES_ROOT / "html"


def _is_loopback(address: object) -> bool:
    """Allow Windows asyncio socketpair fallbacks (connect to 127.0.0.1 / ::1)."""

    host: object
    if isinstance(address, tuple) and address:
        host = address[0]
    else:
        host = address
    if isinstance(host, bytes):
        host = host.decode("ascii", errors="ignore")
    if not isinstance(host, str):
        return False
    return host in {"127.0.0.1", "::1", "localhost"}


@pytest.fixture(autouse=True)
def deny_network(monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest) -> None:
    """Fail tests that attempt real network access unless explicitly opted in."""

    if request.node.get_closest_marker("allow_network"):
        return

    real_create_connection = socket.create_connection
    real_connect = socket.socket.connect

    def blocked_create_connection(address, *args: object, **kwargs: object):
        if _is_loopback(address):
            return real_create_connection(address, *args, **kwargs)
        raise AssertionError("network access is disabled in Search & Discover tests")

    def blocked_connect(self, address):
        if _is_loopback(address):
            return real_connect(self, address)
        raise AssertionError("network access is disabled in Search & Discover tests")

    monkeypatch.setattr(socket, "create_connection", blocked_create_connection)
    monkeypatch.setattr(socket.socket, "connect", blocked_connect)
