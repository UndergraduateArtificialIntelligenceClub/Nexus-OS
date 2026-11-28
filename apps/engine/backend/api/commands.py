"""Per-agent roster verbs (issue #57): the REST surface the roster calls.

A roster agent is either the supervisor of one run (``supervisor:<run_id>``)
or one task packet (``agent_id`` = the task id). The verbs map onto run-level
controls in ``api/runs.py`` and are validated against what the engine can
actually perform - a worker pass cannot be paused or resumed on its own, so
those verbs are supervisor-only, while cancel stops either the run or one
task's own pass. A refusal is a typed ``RunConflict`` (the REST layer answers
409), never a silent no.

Every verb passes the policy gate: stopping work that already required an
approval asks for that same decision through the run's interrupt path, and
the verb is applied only after the human answers. Responses keep the shared
error shape and the run view, so the shell can confirm optimistically, roll
back on rejection, and show a pending approval instead of a silent stop.
"""

from __future__ import annotations

from typing import Any, Optional

from api.agents import SUPERVISOR_ROLE, AgentRoster
from api.hub import SessionHub
from api.runs import TERMINAL, RunConflict, RunManager
from agent.core import CoreEngine
from agent.execution.policy import DecisionOutcome


class AgentNotFound(KeyError):
    pass


class AgentCommands:
    """Resolve a roster agent id to its run, then run the verb."""

    def __init__(
        self,
        engine: CoreEngine,
        hub: SessionHub,
        roster: AgentRoster,
        runs: RunManager,
    ) -> None:
        self._engine = engine
        self._hub = hub
        self._roster = roster
        self._runs = runs

    def _row(self, agent_id: str) -> dict[str, Any]:
        row = self._roster.get(agent_id)
        if row is None:
            raise AgentNotFound(agent_id)
        return row

    def _supervisor_row(self, agent_id: str) -> dict[str, Any]:
        row = self._row(agent_id)
        if row["role"] != SUPERVISOR_ROLE:
            raise RunConflict(
                f"{agent_id} is a {row['role']} agent; the engine cannot pause "
                "or resume one worker pass - use its run")
        return row

    def _answer(self, verb: str, agent_id: str, record: Any,
                approval_required: bool = False) -> dict[str, Any]:
        answer: dict[str, Any] = {
            "verb": verb, "agent_id": agent_id, "run": record.view(),
        }
        if approval_required:
            answer["approval_required"] = True
        return answer

    def _gate(self, verb: str, agent_id: str, record: Any) -> Optional[dict[str, Any]]:
        """Every verb passes policy (#57). Mutating work that is already in
        flight can only be stopped with the same human approval the work
        needed; non-mutating controls are auto-approved."""
        if record.status in TERMINAL:
            return None  # let the verb answer its own honest 409
        if record.status == "awaiting_input" and record.approval_id is not None:
            # The work's own C5 ask is already pending: answering that is the
            # same approval path, so a second question would only deadlock.
            return None
        agent = self._roster.get(agent_id)
        is_task = agent is not None and agent["role"] != SUPERVISOR_ROLE
        if (verb == "cancel" and is_task
                and not self._runs.task_pass_in_flight(record, agent_id)):
            # The engine cannot stop a graph-dispatched pass on its own; let
            # the verb answer its honest 409 instead of asking for a stop that
            # cannot be applied.
            return None
        mutating = self._runs.mutating_work_in_flight(
            record, agent_id if is_task else None
        )
        decision = self._engine.policy.decide_verb(verb, mutating_task=mutating)
        if decision.outcome != DecisionOutcome.approval_required:
            return None
        gated = self._runs.request_verb_approval(
            record, verb, agent_id, decision.reason
        )
        return self._answer(verb, agent_id, gated, approval_required=True)

    # -- run verbs (#57) -------------------------------------------------

    def pause(self, agent_id: str) -> dict[str, Any]:
        row = self._supervisor_row(agent_id)
        record = self._runs.get(row["owner_run_id"])
        gated = self._gate("pause", agent_id, record)
        if gated is not None:
            return gated
        return self._answer("pause", agent_id, self._runs.pause(row["owner_run_id"]))

    def resume(self, agent_id: str) -> dict[str, Any]:
        """Continue a paused run (not the interrupt answer; the shell answers
        interrupts through ``POST /agent/runs/{run_id}/resume``)."""
        row = self._supervisor_row(agent_id)
        record = self._runs.get(row["owner_run_id"])
        gated = self._gate("resume", agent_id, record)
        if gated is not None:
            return gated
        return self._answer("resume", agent_id, self._runs.resume_paused(row["owner_run_id"]))

    async def cancel(self, agent_id: str) -> dict[str, Any]:
        row = self._row(agent_id)
        record = self._runs.get(row["owner_run_id"])
        gated = self._gate("cancel", agent_id, record)
        if gated is not None:
            return gated
        if row["role"] != SUPERVISOR_ROLE:
            return self._answer("cancel", agent_id, await self._runs.cancel_task(agent_id))
        return self._answer("cancel", agent_id, await self._runs.cancel(row["owner_run_id"]))

    # -- retry (#57): a failed run restarts, a failed task re-runs ---------

    def retry(self, agent_id: str) -> dict[str, Any]:
        row = self._row(agent_id)
        record = self._runs.get(row["owner_run_id"])
        gated = self._gate("retry", agent_id, record)
        if gated is not None:
            return gated
        if row["role"] == SUPERVISOR_ROLE:
            record = self._runs.retry_run(row["owner_run_id"])
        else:
            record = self._runs.retry_task(agent_id)
        return self._answer("retry", agent_id, record)

    # -- run_now (#57): planned work starts now ---------------------------

    def run_now(self, agent_id: str) -> dict[str, Any]:
        row = self._row(agent_id)
        if row["role"] == SUPERVISOR_ROLE:
            raise RunConflict(f"{agent_id} is the supervisor; pause it and run its planned tasks now")
        record = self._runs.get(row["owner_run_id"])
        gated = self._gate("run_now", agent_id, record)
        if gated is not None:
            return gated
        record = self._runs.run_now(agent_id)
        return self._answer("run_now", agent_id, record)
