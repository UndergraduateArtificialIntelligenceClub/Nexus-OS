"""Tools manager API (issue #30): scope / policy / last-used per tool and the
tighten-only require-approval override (GET + PATCH /api/v1/tools)."""

from __future__ import annotations

import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import ApiRuntime, create_v1_router, install_error_handlers
from config.engine_settings import EngineSettings

SESSION = "66666666-6666-6666-6666-666666666666"
READ = {"system_diagnostics", "file_search", "memory_lookup", "document_read"}
MUTATE = {"memory_save", "document_create", "open_application"}
NETWORK = {"search_web", "fetch_page"}
VIEW_KEYS = {"tool_id", "version", "capability_group", "description", "risk",
             "side_effect", "native", "availability", "input_schema", "scope",
             "policy", "require_approval", "policy_locked", "last_used_at"}


def _build(tmp_path) -> ApiRuntime:
    return ApiRuntime.build(EngineSettings.for_test(tmp_path, ui_ack_timeout_seconds=0.5))


def _client(runtime: ApiRuntime) -> TestClient:
    app = FastAPI()
    app.include_router(create_v1_router(lambda: runtime))
    install_error_handlers(app)
    return TestClient(app)


@pytest.fixture()
def runtime(tmp_path):
    rt = _build(tmp_path)
    try:
        yield rt
    finally:
        rt.engine.close()


@pytest.fixture()
def client(runtime):
    with _client(runtime) as test_client:
        yield test_client


def _tools(client: TestClient) -> dict[str, dict]:
    response = client.get("/api/v1/tools")
    assert response.status_code == 200, response.text
    return {tool["tool_id"]: tool for tool in response.json()["tools"]}


def test_lists_every_tool_with_scope_policy_and_lock(client):
    tools = _tools(client)
    assert set(tools) == READ | MUTATE | NETWORK
    for tool in tools.values():
        assert set(tool) == VIEW_KEYS
        assert tool["require_approval"] is False
        assert tool["last_used_at"] is None
    assert {t for t, v in tools.items() if v["scope"] == "read"} == READ
    assert {t for t, v in tools.items() if v["scope"] == "mutate"} == MUTATE
    assert {t for t, v in tools.items() if v["scope"] == "network"} == NETWORK
    auto = {t for t, v in tools.items() if v["policy"] == "auto_approve"}
    assert auto == READ
    assert {t for t, v in tools.items() if v["policy"] == "approval_required"} == MUTATE | NETWORK
    # Only tools that run without approval today can be tightened.
    assert {t for t, v in tools.items() if not v["policy_locked"]} == READ


def test_require_approval_tightens_a_read_tool_and_persists(tmp_path):
    first = _build(tmp_path)
    try:
        with _client(first) as client:
            response = client.patch("/api/v1/tools/file_search", json={"require_approval": True})
            assert response.status_code == 200, response.text
            tool = response.json()["tool"]
            assert tool["policy"] == "approval_required"
            assert tool["require_approval"] is True
            assert tool["policy_locked"] is False
    finally:
        first.engine.close()

    second = _build(tmp_path)  # same database: the override survives a restart
    try:
        with _client(second) as client:
            assert _tools(client)["file_search"]["policy"] == "approval_required"
            cleared = client.patch("/api/v1/tools/file_search", json={"require_approval": False})
            assert cleared.json()["tool"]["policy"] == "auto_approve"
            assert cleared.json()["tool"]["require_approval"] is False
    finally:
        second.engine.close()


def test_locked_tool_cannot_be_loosened(client):
    response = client.patch("/api/v1/tools/search_web", json={"require_approval": False})
    assert response.status_code == 200, response.text
    tool = response.json()["tool"]
    assert tool["policy"] == "approval_required"
    assert tool["policy_locked"] is True


def test_patch_rejects_unknown_tool_and_bad_body(client):
    missing = client.patch("/api/v1/tools/delete_everything", json={"require_approval": True})
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "TOOL_UNAVAILABLE"
    extra = client.patch("/api/v1/tools/file_search",
                         json={"require_approval": True, "auto_approve": True})
    assert extra.status_code == 400
    assert extra.json()["error"]["code"] == "INVALID_INPUT"
    wrong_type = client.patch("/api/v1/tools/file_search", json={"require_approval": "yes please"})
    assert wrong_type.status_code == 400


def test_patch_is_audited(client, runtime):
    client.patch("/api/v1/tools/memory_lookup", json={"require_approval": True})
    rows = runtime.engine.repos.audit._fetch_all(
        "SELECT detail FROM audit_events WHERE event_type = 'tool_policy_changed'"
    )
    assert len(rows) == 1 and '"memory_lookup"' in rows[0]["detail"]


def test_last_used_is_set_after_a_run_executes_the_tool(client):
    response = client.post("/api/v1/agent/runs",
                           json={"session_id": SESSION, "text": "run system diagnostics"})
    assert response.status_code == 202, response.text
    run_id = response.json()["run_id"]
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if client.get(f"/api/v1/agent/runs/{run_id}").json()["status"] in {"completed", "failed"}:
            break
        time.sleep(0.02)
    tools = _tools(client)
    assert tools["system_diagnostics"]["last_used_at"] is not None
    assert tools["file_search"]["last_used_at"] is None
