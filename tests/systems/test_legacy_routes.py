"""Issue #40: the legacy ReAct loop and its routes are removed.

``POST /desktop/state`` and ``POST /agent/invoke`` used to answer 503 because
``agent/loop.py`` imported a provider class that no longer exists. They are
gone now; ``/api/v1/agent/runs`` and the ``wm.state`` WebSocket event replace
them (docs/AI-Core/07-api-flow.md).
"""

from __future__ import annotations

import importlib.util

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.mark.parametrize("path", ["/desktop/state", "/agent/invoke"])
def test_legacy_routes_are_removed(path: str) -> None:
    with TestClient(app) as client:
        response = client.post(path, json={"intent": "open browser"})
    assert response.status_code == 404


def test_health_still_answers() -> None:
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200


def test_legacy_loop_module_is_gone() -> None:
    assert importlib.util.find_spec("agent.loop") is None
