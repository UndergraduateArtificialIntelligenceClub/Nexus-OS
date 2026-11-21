"""Unit tests for Wave-1 Automations (Issue #38 Brahma Migration).

Verifies the ToolEntry + adapter pattern, policy classification,
and happy-path / failure-mode criteria for all Wave-1 ports:
- weather_report
- reminder_create
- calendar_schedule
- media_control
- web_search_ddg
- file_control
- open_app alias map
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import pytest
from pydantic import ValidationError

from agent.tools.registry import (
    ToolRegistry,
    WeatherReportInput,
    ReminderCreateInput,
    CalendarScheduleInput,
    MediaControlInput,
    WebSearchDdgInput,
    FileControlInput,
)
from agent.execution.adapters import (
    ADAPTERS,
    AdapterContext,
    UnknownOutcomeError,
    resolve_app_alias,
)
from config.engine_settings import EngineSettings
from schemas.contracts import RiskClass, IdempotencyPolicy


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def mock_ctx(tmp_path: Path) -> AdapterContext:
    settings = EngineSettings.for_test(tmp_path)
    return AdapterContext(
        repos=None,
        settings=settings,
        engine_version="0.1.0",
    )


# ---------------------------------------------------------------------------
# Acceptance Criterion 4: Registry Schema Validation Test
# ---------------------------------------------------------------------------

def test_registry_schema_integrity():
    """Verify all registered tools have corresponding adapters and valid schemas."""
    registry = ToolRegistry()
    entries = registry.all_entries()
    assert len(entries) >= 12, "Should contain existing tools + Wave-1 tools"

    for entry in entries:
        assert entry.tool_id, "tool_id must not be empty"
        assert entry.version == "1", "version must be 1"
        assert entry.capability_group, "capability_group must not be empty"
        assert entry.input_model is not None, "input_model must be defined"
        assert len(entry.output_keys) > 0, "output_keys must not be empty"
        assert isinstance(entry.risk, RiskClass), "risk must be a valid RiskClass"
        assert isinstance(entry.idempotency, IdempotencyPolicy), "idempotency must be valid"

        if entry.native:
            assert entry.native_command_id, "native entries must declare native_command_id"
        else:
            assert entry.adapter_id in ADAPTERS, f"Missing adapter for '{entry.tool_id}' ({entry.adapter_id})"


# ---------------------------------------------------------------------------
# Wave-1 Port Tests: Happy Path + Failure Mode + Policy Classification
# ---------------------------------------------------------------------------

# 1. Weather Report (RiskClass.read_only)
def test_weather_report_happy_path(mock_ctx: AdapterContext):
    adapter = ADAPTERS["python.weather_report"]
    res = run(adapter({"location": "Vancouver", "units": "m"}, mock_ctx))
    assert res["location"] == "Vancouver"
    assert "temperature" in res
    assert "condition" in res
    assert res["units"] == "m"


def test_weather_report_invalid_units():
    with pytest.raises(ValidationError):
        WeatherReportInput(location="Vancouver", units="kelvin")


# 2. Reminder Create (RiskClass.reversible_write)
def test_reminder_create_happy_path(mock_ctx: AdapterContext):
    adapter = ADAPTERS["python.reminder_create"]
    res = run(adapter({
        "title": "Review pull request",
        "due_at_iso": "2026-11-25T10:00:00Z",
        "priority": "high",
    }, mock_ctx))
    assert res["title"] == "Review pull request"
    assert res["priority"] == "high"
    assert res["status"] == "scheduled"
    assert res["reminder_id"].startswith("reminder:")


def test_reminder_create_invalid_priority():
    with pytest.raises(ValidationError):
        ReminderCreateInput(title="Task", due_at_iso="2026-11-25T10:00:00Z", priority="super-urgent")


# 3. Calendar Schedule (RiskClass.reversible_write)
def test_calendar_schedule_happy_path(mock_ctx: AdapterContext):
    adapter = ADAPTERS["python.calendar_schedule"]
    res = run(adapter({
        "title": "Team Sprint Sync",
        "start_time_iso": "2026-11-22T09:00:00Z",
        "end_time_iso": "2026-11-22T10:00:00Z",
    }, mock_ctx))
    assert res["title"] == "Team Sprint Sync"
    assert res["status"] == "confirmed"
    assert res["event_id"].startswith("event:")


def test_calendar_schedule_inverted_interval_fails(mock_ctx: AdapterContext):
    adapter = ADAPTERS["python.calendar_schedule"]
    with pytest.raises(ValueError, match="must be after start_time_iso"):
        run(adapter({
            "title": "Invalid Meeting",
            "start_time_iso": "2026-11-22T10:00:00Z",
            "end_time_iso": "2026-11-22T09:00:00Z",
        }, mock_ctx))


# 4. Media Control (RiskClass.reversible_write)
def test_media_control_happy_path(mock_ctx: AdapterContext):
    adapter = ADAPTERS["python.media_control"]
    for action in ("play", "pause", "toggle", "next", "volume_up"):
        res = run(adapter({"action": action}, mock_ctx))
        assert res["action"] == action
        assert res["status"] == "executed"


def test_media_control_invalid_action():
    with pytest.raises(ValidationError):
        MediaControlInput(action="eject_disc")


# 5. Web Search DuckDuckGo (RiskClass.read_only)
def test_web_search_ddg_happy_path(mock_ctx: AdapterContext):
    adapter = ADAPTERS["python.web_search_ddg"]
    res = run(adapter({"query": "Nexus OS documentation", "limit": 3}, mock_ctx))
    assert res["query"] == "Nexus OS documentation"
    assert len(res["results"]) == 3
    assert res["total"] == 3
    assert "url" in res["results"][0]


def test_web_search_ddg_invalid_limit():
    with pytest.raises(ValidationError):
        WebSearchDdgInput(query="test", limit=50)


# 6. File Control with Shared Undo Stack (RiskClass.reversible_write)
def test_file_control_write_read_delete_with_undo(mock_ctx: AdapterContext, tmp_path: Path):
    adapter = ADAPTERS["python.file_control"]
    test_file = tmp_path / "artifacts" / "notes" / "todo.txt"

    # Write operation creates file and provides undo receipt
    write_res = run(adapter({
        "operation": "write",
        "path": str(test_file),
        "content": "Buy milk",
    }, mock_ctx))
    assert write_res["status"] == "completed"
    assert write_res["undo_id"].startswith("undo:")
    assert write_res["undo_receipt"]["revert_operation"] == "delete"
    assert test_file.read_text(encoding="utf-8") == "Buy milk"

    # Overwrite operation stores previous content in undo receipt
    overwrite_res = run(adapter({
        "operation": "write",
        "path": str(test_file),
        "content": "Buy coffee",
    }, mock_ctx))
    assert overwrite_res["undo_receipt"]["revert_operation"] == "write"
    assert overwrite_res["undo_receipt"]["previous_content"] == "Buy milk"

    # Read operation
    read_res = run(adapter({
        "operation": "read",
        "path": str(test_file),
    }, mock_ctx))
    assert read_res["operation"] == "read"
    assert "Buy coffee" in read_res["undo_receipt"]["content_preview"]

    # Delete operation stores deleted content for restoration
    delete_res = run(adapter({
        "operation": "delete",
        "path": str(test_file),
    }, mock_ctx))
    assert delete_res["undo_receipt"]["revert_operation"] == "restore"
    assert delete_res["undo_receipt"]["restored_content"] == "Buy coffee"
    assert not test_file.exists()


def test_file_control_unapproved_root_rejected(mock_ctx: AdapterContext):
    adapter = ADAPTERS["python.file_control"]
    unapproved_path = Path("C:/Windows/System32/drivers/etc/hosts") if Path("C:/Windows").exists() else Path("/etc/hosts")
    with pytest.raises(UnknownOutcomeError, match="outside approved workspace roots"):
        run(adapter({
            "operation": "write",
            "path": str(unapproved_path),
            "content": "unauthorized edit",
        }, mock_ctx))


# 7. Open App Alias Mapping
def test_open_app_alias_resolution():
    assert resolve_app_alias("browser") == "browser"
    assert resolve_app_alias("CHROME") == "browser"
    assert resolve_app_alias("calc") == "calc"
    assert resolve_app_alias("calculator") == "calc"
    assert resolve_app_alias("notepad") == "notes"
    assert resolve_app_alias("terminal") == "terminal"
    assert resolve_app_alias("unknown_custom_binary") == "unknown_custom_binary"
