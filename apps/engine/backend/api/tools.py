"""Tool catalogue for the shell's Tools manager (issue #30).

``GET /api/v1/tools`` lists every registered tool with what it can touch
(``scope``), how policy gates it right now (``policy``), whether the user
tightened it (``require_approval``), whether that toggle can change anything
(``policy_locked``), and when the gateway last ran it (``last_used_at``).

``PATCH /api/v1/tools/{tool_id}`` sets or clears the user override. It is
tighten-only: an override adds an approval requirement; clearing it falls back
to the registry/settings policy and never lets a tool run without approval when
policy already requires one (docs/AI-Core/06-extending-nexus.md, stop-and-ask).
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict

from agent.execution.policy import Policy
from schemas.contracts import RiskClass

ToolScope = Literal["read", "mutate", "network"]


class PatchToolBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    require_approval: bool


def tool_scope(entry: Any) -> ToolScope:
    """What the tool can touch: the network, local state, or read only."""
    if entry.capability_group == "network.web":
        return "network"
    if entry.side_effect or entry.risk != RiskClass.read_only:
        return "mutate"
    return "read"


def tool_view(
    entry: Any,
    policy: Policy,
    overrides: dict[str, bool],
    last_used: dict[str, str],
) -> dict[str, Any]:
    """Wire shape of one tool (mirrored by ``EngineTool`` in the shell's
    ``types/agentEvents.ts``; change both together)."""
    return {
        "tool_id": entry.tool_id,
        "version": entry.version,
        "capability_group": entry.capability_group,
        "description": entry.description,
        "risk": entry.risk.value,
        "side_effect": entry.side_effect,
        "native": entry.native,
        "availability": entry.availability,
        "input_schema": entry.input_model.model_json_schema(),
        "scope": tool_scope(entry),
        "policy": policy.static_outcome(entry).value,
        "require_approval": overrides.get(entry.tool_id, False),
        "policy_locked": policy.base_requires_approval(entry),
        "last_used_at": last_used.get(entry.tool_id),
    }


def list_tool_views(engine: Any) -> list[dict[str, Any]]:
    overrides = engine.repos.tool_overrides.get_all()
    last_used = engine.repos.executions.last_used_by_tool()
    return [
        tool_view(entry, engine.policy, overrides, last_used)
        for entry in engine.registry.all_entries()
    ]


def set_require_approval(engine: Any, tool_id: str, require_approval: bool) -> Optional[dict[str, Any]]:
    """Apply the user's toggle; ``None`` when the tool is not registered."""
    try:
        entry = engine.registry.get(tool_id)
    except KeyError:
        return None
    if require_approval:
        engine.repos.tool_overrides.set(tool_id, True)
    else:
        engine.repos.tool_overrides.clear(tool_id)
    engine.repos.audit.append(
        "tool_policy_changed", None, None,
        {"tool_id": tool_id, "require_approval": require_approval},
    )
    overrides = engine.repos.tool_overrides.get_all()
    last_used = engine.repos.executions.last_used_by_tool()
    return tool_view(entry, engine.policy, overrides, last_used)


__all__ = ["PatchToolBody", "list_tool_views", "set_require_approval", "tool_scope", "tool_view"]
