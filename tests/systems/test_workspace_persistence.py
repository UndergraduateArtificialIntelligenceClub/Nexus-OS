"""SQLite-backed workspace persistence (issue #28).

The shell saves its versioned layout envelope with ``PUT /api/v1/workspaces/{id}``
(``persist_workspace``) and restores it on launch with ``GET``. These tests
drive the real router over a per-test SQLite file, including a database that
was seeded before the engine started.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import ApiRuntime, create_v1_router, install_error_handlers, install_local_cors
from config.engine_settings import REPO_ROOT, EngineSettings

FIXTURE = Path(__file__).parent / "fixtures" / "workspace_layout_v1.json"


def _db_path(settings: EngineSettings) -> Path:
    return Path(settings.database_url.removeprefix("sqlite:///"))


def _client_for(settings: EngineSettings):
    runtime = ApiRuntime.build(settings)
    app = FastAPI()
    app.include_router(create_v1_router(lambda: runtime))
    install_error_handlers(app)
    install_local_cors(app)
    return runtime, TestClient(app)


@pytest.fixture()
def settings(tmp_path: Path) -> EngineSettings:
    return EngineSettings.for_test(tmp_path)


@pytest.fixture()
def client(settings):
    runtime, test_client = _client_for(settings)
    with test_client:
        yield test_client
    runtime.engine.close()


def _seed(settings: EngineSettings, workspace_id: str, name: str, layout_text: str) -> None:
    """Write a row the way an earlier engine run would have, before startup."""
    db = _db_path(settings)
    db.parent.mkdir(parents=True, exist_ok=True)
    schema = (REPO_ROOT / "modules" / "storage" / "schema.sql").read_text(encoding="utf-8")
    with sqlite3.connect(db) as conn:
        conn.executescript(schema)
        conn.execute("INSERT INTO workspaces (id, name, layout) VALUES (?, ?, ?)",
                     (workspace_id, name, layout_text))


def test_restore_on_launch_from_a_pre_seeded_db(settings):
    _seed(settings, "default", "Default", FIXTURE.read_text(encoding="utf-8"))
    runtime, test_client = _client_for(settings)
    with test_client as client:
        res = client.get("/api/v1/workspaces/default")
    runtime.engine.close()

    assert res.status_code == 200
    body = res.json()
    assert body["workspace_id"] == "default"
    assert body["name"] == "Default"
    assert body["layout"] == json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert body["layout"]["session"]["focusedId"] == "notes-seed2"


def test_persist_then_load_round_trips_the_envelope(client, settings):
    layout = json.loads(FIXTURE.read_text(encoding="utf-8"))
    res = client.put("/api/v1/workspaces/default", json={"name": "Default", "layout": layout})
    assert res.status_code == 200
    assert res.json() == {"saved": True, "workspace_id": "default", "saved_at": layout["savedAt"]}

    assert client.get("/api/v1/workspaces/default").json()["layout"] == layout

    with sqlite3.connect(_db_path(settings)) as conn:
        (stored,) = conn.execute("SELECT layout FROM workspaces WHERE id = 'default'").fetchone()
    assert json.loads(stored) == layout


def test_persist_overwrites_the_same_workspace(client, settings):
    first = json.loads(FIXTURE.read_text(encoding="utf-8"))
    second = {**first, "savedAt": "2026-11-21T09:00:00.000Z",
              "session": {"instances": [], "focusedId": None}}
    client.put("/api/v1/workspaces/default", json={"layout": first})
    client.put("/api/v1/workspaces/default", json={"name": "Renamed", "layout": second})

    body = client.get("/api/v1/workspaces/default").json()
    assert body["layout"] == second
    assert body["name"] == "Renamed"
    with sqlite3.connect(_db_path(settings)) as conn:
        assert conn.execute("SELECT COUNT(*) FROM workspaces").fetchone() == (1,)


def test_saved_layout_survives_an_engine_restart(settings):
    layout = json.loads(FIXTURE.read_text(encoding="utf-8"))
    runtime, test_client = _client_for(settings)
    with test_client as client:
        client.put("/api/v1/workspaces/default", json={"layout": layout})
    runtime.engine.close()

    runtime, test_client = _client_for(settings)
    with test_client as client:
        assert client.get("/api/v1/workspaces/default").json()["layout"] == layout
    runtime.engine.close()


def test_missing_workspace_is_not_found(client):
    res = client.get("/api/v1/workspaces/default")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.parametrize("layout, message", [
    ({"savedAt": "x", "session": {}}, "layout.version"),
    ({"version": 0, "savedAt": "x", "session": {}}, "layout.version"),
    ({"version": True, "savedAt": "x", "session": {}}, "layout.version"),
    ({"version": 1, "session": {}}, "layout.savedAt"),
    ({"version": 1, "savedAt": "x", "session": []}, "layout.session"),
])
def test_persist_rejects_a_malformed_envelope(client, layout, message):
    res = client.put("/api/v1/workspaces/default", json={"layout": layout})
    assert res.status_code == 400
    assert message in res.json()["error"]["message"]


def test_persist_rejects_bad_ids_and_bodies(client):
    ok = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert client.put("/api/v1/workspaces/bad%20id", json={"layout": ok}).status_code == 400
    assert client.get("/api/v1/workspaces/" + "x" * 65).status_code == 400
    assert client.put("/api/v1/workspaces/default", json={"layout": "nope"}).status_code == 400
    assert client.put("/api/v1/workspaces/default", json={"layout": ok, "extra": 1}).status_code == 400


def test_persist_rejects_an_oversized_layout(client):
    big = {"version": 1, "savedAt": "x", "session": {"blob": "a" * (300 * 1024)}}
    res = client.put("/api/v1/workspaces/default", json={"layout": big})
    assert res.status_code == 413


def test_corrupt_stored_layout_is_reported_not_crashed(settings):
    _seed(settings, "default", "Default", "{not json")
    runtime, test_client = _client_for(settings)
    with test_client as client:
        res = client.get("/api/v1/workspaces/default")
    runtime.engine.close()
    assert res.status_code == 500
    assert res.json()["error"]["code"] == "STORAGE_CORRUPT"


@pytest.mark.parametrize("origin", [
    "http://localhost:5173", "tauri://localhost", "http://tauri.localhost", "http://127.0.0.1:1420",
])
def test_cors_allows_the_local_shell_origins(client, origin):
    res = client.options("/api/v1/workspaces/default", headers={
        "Origin": origin, "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
    })
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == origin


def test_cors_refuses_other_origins(client):
    res = client.options("/api/v1/workspaces/default", headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "PUT",
    })
    assert "access-control-allow-origin" not in res.headers
