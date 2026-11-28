"""AgentRoster: a stable identity and an honest status for every engine agent.

Answers "what is this agent doing, for whom, since when?" for the agents
manager (docs/agents-manager/agent-identity.md).

Two kinds of agents exist per run:

- one ``supervisor`` agent (``supervisor:<run_id>``): the main graph working
  on the run, on every route
- one worker agent per task packet (``agent_id`` = the task id): the bounded
  worker pass for a discovery / knowledge / desktop / recipe task

The roster only observes. Status comes from facts the engine already
records: run transitions (RunManager), task packets created by the plan,
and worker passes (``TaskWorker.add_listener``). Every change is published
as ``agent.updated`` with the full identity; ``GET /api/v1/agents`` is the
catch-up path.
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

from api.events import AgentStatus, EventType
from api.hub import SessionHub
from api.ui_bridge import current_run_id, current_session_id
from schemas.contracts import AgentResult, AgentResultStatus, TaskPacket, utc_now_iso

SUPERVISOR_ROLE = "supervisor"
_LABEL_CHARS = 60
_ACTIVITY_CHARS = 200

# C9 AgentResult.status -> roster status. ``needs_input`` is only returned
# when policy created an approval, so ``waiting`` means a real decision is
# pending. ``blocked`` is an unknown_outcome receipt: the work cannot be
# verified and is never retried blindly, so it is surfaced as ``error``.
RESULT_STATUS: dict[AgentResultStatus, AgentStatus] = {
    AgentResultStatus.completed: AgentStatus.done,
    AgentResultStatus.needs_input: AgentStatus.waiting,
    AgentResultStatus.failed: AgentStatus.error,
    AgentResultStatus.blocked: AgentStatus.error,
}

_OPEN = (AgentStatus.idle.value, AgentStatus.running.value, AgentStatus.waiting.value)


def supervisor_id(run_id: str) -> str:
    return f"{SUPERVISOR_ROLE}:{run_id}"


def _clip(text: str, limit: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


@dataclass
class AgentRecord:
    agent_id: str
    role: str
    label: str
    status: str
    owner_run_id: str
    session_id: str
    last_activity: str = ""
    since: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)

    def view(self) -> dict[str, Any]:
        """Wire shape for ``agent.updated`` and ``GET /api/v1/agents``."""
        return {
            "agent_id": self.agent_id,
            "role": self.role,
            "label": self.label,
            "status": self.status,
            "since": self.since,
            "owner_run_id": self.owner_run_id,
            "last_activity": self.last_activity,
            "updated_at": self.updated_at,
        }


class AgentRoster:
    def __init__(self, hub: SessionHub) -> None:
        self._hub = hub
        self._agents: OrderedDict[str, AgentRecord] = OrderedDict()

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    def list(self, session_id: Optional[str] = None) -> list[dict[str, Any]]:
        return [record.view() for record in self._agents.values()
                if session_id is None or record.session_id == session_id]

    def get(self, agent_id: str) -> Optional[dict[str, Any]]:
        """One roster row, or None when the engine does not know the agent."""
        record = self._agents.get(agent_id)
        return record.view() if record is not None else None

    # ------------------------------------------------------------------
    # Run transitions (called by RunManager)
    # ------------------------------------------------------------------

    def run_running(self, run_id: str, session_id: str, activity: str) -> None:
        self._upsert(supervisor_id(run_id), SUPERVISOR_ROLE, SUPERVISOR_ROLE,
                     run_id, session_id, AgentStatus.running, activity)

    def run_paused(self, run_id: str, activity: str) -> None:
        """#57: a cooperative pause halts the supervisor; its task rows keep
        the statuses their completed passes left them with."""
        self._update(supervisor_id(run_id), AgentStatus.paused, activity)

    def run_waiting(self, run_id: str, activity: str) -> None:
        self._update(supervisor_id(run_id), AgentStatus.waiting, activity)

    def task_cancelled(self, agent_id: str) -> None:
        """#57: a cancelled task is `done` with that word in its activity; the
        status set has no `cancelled` (agent identity contract)."""
        self._update(agent_id, AgentStatus.done, "cancelled")

    def run_finished(self, run_id: str, status: AgentStatus, activity: str) -> None:
        """Close the run: the supervisor takes ``status``; worker agents
        that are still open can no longer progress, so they are closed with
        a reason instead of being left looking alive."""
        for record in list(self._agents.values()):
            if record.owner_run_id != run_id or record.role == SUPERVISOR_ROLE:
                continue
            if record.status == AgentStatus.idle.value:
                self._update(record.agent_id, AgentStatus.done,
                             "not started: the run ended first")
            elif record.status in _OPEN:
                closing = AgentStatus.done if status == AgentStatus.done else AgentStatus.error
                self._update(record.agent_id, closing, activity)
        self._update(supervisor_id(run_id), status, activity)

    def tasks_planned(self, run_id: str, session_id: str, packets: Iterable[TaskPacket]) -> None:
        """Planned packets are known but not started yet (``idle``)."""
        for packet in packets:
            if packet.task_id not in self._agents:
                self._upsert(packet.task_id, packet.assigned_to.value,
                             _clip(packet.objective, _LABEL_CHARS), run_id, session_id,
                             AgentStatus.idle, "planned")

    def forget_run(self, run_id: str) -> None:
        for agent_id in [a for a, r in self._agents.items() if r.owner_run_id == run_id]:
            del self._agents[agent_id]

    # ------------------------------------------------------------------
    # Worker passes (TaskWorker listener)
    # ------------------------------------------------------------------

    def on_worker(self, kind: str, packet: TaskPacket, result: Optional[AgentResult]) -> None:
        run_id, session_id = current_run_id.get(), current_session_id.get()
        if run_id is None or session_id is None:
            return  # not part of an /api/v1 run (e.g. the legacy C1 route)
        if kind == "started":
            self._upsert(packet.task_id, packet.assigned_to.value,
                         _clip(packet.objective, _LABEL_CHARS), run_id, session_id,
                         AgentStatus.running, packet.objective)
        elif kind == "finished":
            if result is None:
                self._update(packet.task_id, AgentStatus.error, "worker produced no result")
            else:
                self._update(packet.task_id, RESULT_STATUS[result.status], result.summary)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _upsert(self, agent_id: str, role: str, label: str, run_id: str, session_id: str,
                status: AgentStatus, activity: str) -> None:
        if agent_id not in self._agents:
            self._agents[agent_id] = AgentRecord(
                agent_id=agent_id, role=role, label=label, status=status.value,
                owner_run_id=run_id, session_id=session_id,
                last_activity=_clip(activity, _ACTIVITY_CHARS),
            )
            self._publish(self._agents[agent_id])
            return
        self._update(agent_id, status, activity)

    def _update(self, agent_id: str, status: AgentStatus, activity: str) -> None:
        record = self._agents.get(agent_id)
        if record is None:
            return
        activity = _clip(activity, _ACTIVITY_CHARS)
        if record.status == status.value and record.last_activity == activity:
            return
        now = utc_now_iso()
        if record.status != status.value:
            record.status = status.value
            record.since = now
        record.last_activity = activity
        record.updated_at = now
        self._publish(record)

    def _publish(self, record: AgentRecord) -> None:
        self._hub.publish(record.session_id, EventType.agent_updated, record.view(),
                          run_id=record.owner_run_id)
