"""Agent identity contract (issue #54): roster statuses, agent.updated
events, and GET /api/v1/agents. Contract: docs/agents-manager/agent-identity.md.
"""

from __future__ import annotations

import time
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import ApiRuntime, create_v1_router, install_error_handlers
from config.engine_settings import EngineSettings

SESSION = "44444444-4444-4444-4444-444444444444"
OTHER_SESSION = "55555555-5555-5555-5555-555555555555"
AGENT_KEYS = {"agent_id", "role", "label", "status", "since", "owner_run_id",
              "last_activity", "updated_at"}
STATUSES = {"idle", "running", "waiting", "paused", "done", "error"}


@pytest.fixture()
def runtime(tmp_path):
    rt = ApiRuntime.build(EngineSettings.for_test(tmp_path, ui_ack_timeout_seconds=0.5))
    try:
        yield rt
    finally:
        rt.engine.close()


@pytest.fixture()
def client(runtime):
    app = FastAPI()
    app.include_router(create_v1_router(lambda: runtime))
    install_error_handlers(app)
    with TestClient(app) as test_client:
        yield test_client


def _start(client: TestClient, text: str, session_id: str = SESSION) -> str:
    response = client.post("/api/v1/agent/runs", json={"session_id": session_id, "text": text})
    assert response.status_code == 202, response.text
    return response.json()["run_id"]


def _until(ws, event_type: str, limit: int = 80) -> list[dict[str, Any]]:
    events = []
    for _ in range(limit):
        events.append(ws.receive_json())
        if events[-1]["type"] == event_type:
            return events
    raise AssertionError(f"no {event_type}; got {[e['type'] for e in events]}")


def _agents(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    updates = [e for e in events if e["type"] == "agent.updated"]
    for update in updates:
        assert set(update["data"]) == AGENT_KEYS
        assert update["data"]["status"] in STATUSES
        assert update["run_id"] == update["data"]["owner_run_id"]
    return [e["data"] for e in updates]


def _history(updates: list[dict[str, Any]], agent_id: str) -> list[str]:
    statuses = [u["status"] for u in updates if u["agent_id"] == agent_id]
    return [s for i, s in enumerate(statuses) if i == 0 or statuses[i - 1] != s]


def _roster(client: TestClient, session_id: str = SESSION) -> dict[str, dict[str, Any]]:
    response = client.get("/api/v1/agents", params={"session_id": session_id})
    assert response.status_code == 200
    return {agent["agent_id"]: agent for agent in response.json()["agents"]}


def _poll_roster(client: TestClient, agent_id: str, status: str, seconds: float = 10) -> dict:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        agent = _roster(client).get(agent_id)
        if agent is not None and agent["status"] == status:
            return agent
        time.sleep(0.02)
    raise AssertionError(f"{agent_id} never reached {status}: {_roster(client).get(agent_id)}")


def test_confirm_run_full_agent_lifecycle(client):
    with client.websocket_connect(f"/api/v1/ws?session_id={SESSION}") as ws:
        run_id = _start(client, "open browser")
        before = _agents(_until(ws, "run.interrupt"))
        supervisor = f"supervisor:{run_id}"
        task = next(u["agent_id"] for u in before if u["role"] == "recipe")

        # waiting only once a real approval exists, for both the task and the run
        assert _history(before, supervisor) == ["running", "waiting"]
        assert _history(before, task) == ["running", "waiting"]
        waiting = _roster(client)[task]
        assert waiting["last_activity"].startswith("Allow open_application")

        client.post(f"/api/v1/agent/runs/{run_id}/resume", json={"resume": "yes"})
        events = _until(ws, "ui.command")
        command = events[-1]["data"]
        ws.send_json({"type": "ui.command.ack", "session_id": SESSION, "run_id": run_id,
                      "data": {"command_id": command["command_id"], "ok": True}})
        after = _agents(events + _until(ws, "run.completed"))

    assert _history(after, supervisor) == ["running", "done"]
    assert _history(after, task) == ["running", "done"]
    roster = _roster(client)
    assert set(roster) == {supervisor, task}
    assert roster[supervisor]["role"] == "supervisor"
    assert roster[supervisor]["label"] == "supervisor"
    assert roster[task]["label"] == "Open application browser"
    assert {agent["owner_run_id"] for agent in roster.values()} == {run_id}
    assert all(agent["status"] == "done" for agent in roster.values())
    # since marks the last status change, never later than the last update
    assert roster[task]["since"] >= waiting["since"]
    assert roster[task]["since"] <= roster[task]["updated_at"]


def test_planned_tasks_start_idle_until_dispatched(client):
    with client.websocket_connect(f"/api/v1/ws?session_id={SESSION}") as ws:
        run_id = _start(client, "research langgraph checkpointers and write a report")
        updates = _agents(_until(ws, "run.interrupt"))

    workers = [u["agent_id"] for u in updates if u["role"] != "supervisor"]
    workers = list(dict.fromkeys(workers))
    assert len(workers) == 3
    for agent_id in workers:
        assert _history(updates, agent_id)[0] == "idle"
    finished = [a for a in workers if _history(updates, a) == ["idle", "running", "done"]]
    report = [a for a in workers if _history(updates, a) == ["idle", "running", "waiting"]]
    assert len(finished) == 2 and len(report) == 1
    # the report task depends on the other two: it starts only after both finish
    order = [(u["agent_id"], u["status"]) for u in updates]
    assert order.index((report[0], "running")) > max(order.index((a, "done")) for a in finished)
    assert _roster(client)[f"supervisor:{run_id}"]["status"] == "waiting"


def test_clarify_waits_on_the_supervisor_only(client):
    with client.websocket_connect(f"/api/v1/ws?session_id={SESSION}") as ws:
        run_id = _start(client, "open time machine")
        updates = _agents(_until(ws, "run.interrupt"))

    assert {u["agent_id"] for u in updates} == {f"supervisor:{run_id}"}
    supervisor = _roster(client)[f"supervisor:{run_id}"]
    assert supervisor["status"] == "waiting"
    assert "Which application" in supervisor["last_activity"]


def test_failed_tool_is_an_error(client):
    run_id = _start(client, "open browser")  # no socket: native work fails closed
    supervisor = _poll_roster(client, f"supervisor:{run_id}", "waiting")
    assert supervisor["status"] == "waiting"
    client.post(f"/api/v1/agent/runs/{run_id}/resume", json={"resume": "yes"})
    task = next(a for a in _roster(client) if a.startswith("task:"))
    failed = _poll_roster(client, task, "error")
    assert failed["last_activity"]


def test_cancel_closes_open_agents_as_done(client):
    with client.websocket_connect(f"/api/v1/ws?session_id={SESSION}") as ws:
        run_id = _start(client, "open browser")
        _until(ws, "run.interrupt")
        client.post(f"/api/v1/agent/runs/{run_id}/cancel")
        _until(ws, "run.completed")

    roster = _roster(client)
    assert len(roster) == 2
    for agent in roster.values():
        assert agent["status"] == "done" and agent["last_activity"] == "cancelled"


def test_roster_is_scoped_by_session(client):
    with client.websocket_connect(f"/api/v1/ws?session_id={OTHER_SESSION}") as other:
        mine = _start(client, "run system diagnostics")
        _poll_roster(client, f"supervisor:{mine}", "done")
        theirs = _start(client, "run system diagnostics", session_id=OTHER_SESSION)
        events = _until(other, "run.completed")

    assert {e["run_id"] for e in events} == {theirs}
    assert {a["owner_run_id"] for a in _roster(client).values()} == {mine}
    assert {a["owner_run_id"] for a in _roster(client, OTHER_SESSION).values()} == {theirs}
    everything = client.get("/api/v1/agents").json()["agents"]
    assert {a["owner_run_id"] for a in everything} == {mine, theirs}

    bad = client.get("/api/v1/agents", params={"session_id": "nope"})
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "INVALID_INPUT"


def test_a_failing_listener_never_breaks_the_worker(client, runtime):
    def broken(kind, packet, result):
        raise RuntimeError("observer bug")

    runtime.engine.worker.add_listener(broken)
    run_id = _start(client, "run system diagnostics")
    agent = _poll_roster(client, f"supervisor:{run_id}", "done")
    assert "diagnostics" in agent["last_activity"].lower()
