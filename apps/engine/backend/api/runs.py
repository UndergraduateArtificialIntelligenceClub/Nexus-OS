"""RunManager: one *run* per user interaction, executed in the background
and narrated over the session WebSocket.

A run wraps one or more engine requests (C1). It starts with
``POST /api/v1/agent/runs``; if the graph stops for a human (approval or
clarification) the run pauses with an ``interrupt`` and the same ``run_id``
continues on ``POST .../resume``. ``run_id`` is the first request's
``request_id``, so audit rows stay linked.

Run statuses (API-level, see docs/AI-Core/07-api-flow.md):
    received -> running -> (awaiting_input -> running)* -> completed | failed | cancelled
A run may also pause cooperatively (running -> paused -> running, #57): the
current node - including an in-flight tool call - completes first, then the
run halts at a node boundary and continues from its checkpoint.

Roster verbs (#57) live here: supervisors carry the run-level controls, and
``cancel_task`` stops one standalone worker pass without closing its run.
``api/commands.py`` maps roster agents onto them. Every verb passes the
policy gate: stopping mutating work needs the same approval as the work
itself, asked through this run's ``run.interrupt`` and answered by
``resume``. Cooperative stops still let an in-flight call finish first, so
no mutation is half-applied.
Interrupts can time out per policy (#58): ``auto_deny``
fails the run cleanly, ``escalate`` re-issues the ask before denying.
"""

from __future__ import annotations

import asyncio
import json
import secrets
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from agent.core import CoreEngine, CoreRequestResult
from agent.graphs.run_gate import RunCancelled, RunPaused, gate_error_of
from api.agents import SUPERVISOR_ROLE, AgentRoster
from api.events import (
    NODE_AGENT_STATE,
    PLAN_NODES,
    RESULT_NODES,
    RESULT_TASK_STATUS,
    AgentState,
    AgentStatus,
    EventType,
    InterruptKind,
    RunOutcome,
    Source,
    api_error,
)
from api.hub import SessionHub
from api.ui_bridge import current_run_id, current_session_id
from schemas.contracts import (
    AgentResultStatus,
    ApprovalRequest,
    ApprovalStatus,
    RequestEnvelope,
    TaskPacket,
    ToolProposal,
    utc_now_iso,
)

TERMINAL = frozenset({"completed", "failed", "cancelled"})
_YES = {"yes", "y", "approve", "approved", "confirm", "ok", "true"}
_NO = {"no", "n", "reject", "rejected", "deny", "cancel", "false"}
_MAX_FINISHED_RUNS = 200
# Bounded wait: how long a cooperative stop may take before the engine
# falls back to a hard stop. Tool adapters are timeout-bounded themselves.
_CANCEL_WAIT_SECONDS = 5.0


class RunNotFound(KeyError):
    pass


class RunConflict(RuntimeError):
    """The run is not in a state that allows this action."""


@dataclass
class RunRecord:
    run_id: str
    session_id: str
    source: str
    status: str = "received"
    agent_state: str = AgentState.idle.value
    route: Optional[str] = None
    request_ids: list[str] = field(default_factory=list)
    response: Optional[dict[str, Any]] = None
    interrupt: Optional[dict[str, Any]] = None  # wire shape {kind, message, options}
    approval_id: Optional[str] = field(default=None, repr=False)  # server-side only
    errors: list[dict[str, Any]] = field(default_factory=list)
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)
    task: Optional[asyncio.Task[None]] = field(default=None, repr=False)
    # --- Roster verbs (#57) ---
    #: The request whose main graph is executing; a cooperative stop lands
    #: at its next node boundary. None when no graph is in flight.
    active_thread: Optional[str] = field(default=None, repr=False)
    #: #58: how many times an expired interrupt was re-issued (escalate).
    escalations: int = 0
    interrupt_watchdog: Optional[asyncio.Task[None]] = field(default=None, repr=False)
    #: The in-flight retry / run_now worker pass (#57), kept referenced so the
    #: event loop cannot drop it. ``verb_task_id`` says which roster row owns
    #: it, so a per-task cancel cannot stop a sibling's pass.
    verb_task: Optional[asyncio.Task[None]] = field(default=None, repr=False)
    verb_task_id: Optional[str] = field(default=None, repr=False)
    #: A roster verb waiting for the same approval path as the work it stops
    #: (issue #57). Kept beside ``approval_id`` so ``resume`` can tell a verb's
    #: question from a task's question.
    pending_verb: Optional[dict[str, Any]] = field(default=None, repr=False)

    def view(self) -> dict[str, Any]:
        """REST shape for ``GET /api/v1/agent/runs/{run_id}``."""
        return {
            "run_id": self.run_id,
            "session_id": self.session_id,
            "source": self.source,
            "status": self.status,
            "agent_state": self.agent_state,
            "route": self.route,
            "request_ids": list(self.request_ids),
            "response": self.response,
            "interrupt": self.interrupt,
            "errors": list(self.errors),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class RunManager:
    def __init__(self, engine: CoreEngine, hub: SessionHub,
                 roster: Optional[AgentRoster] = None) -> None:
        self._engine = engine
        self._hub = hub
        self._roster = roster or AgentRoster(hub)
        self._runs: OrderedDict[str, RunRecord] = OrderedDict()
        self._graph_lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Public actions (called by the REST routes)
    # ------------------------------------------------------------------

    def get(self, run_id: str) -> RunRecord:
        record = self._runs.get(run_id)
        if record is None:
            raise RunNotFound(run_id)
        return record

    def start(
        self,
        text: str,
        session_id: str,
        source: Source,
        ui_context: Optional[dict[str, Any]] = None,
    ) -> RunRecord:
        """Validate the request (raises ValueError) and run it in the background."""
        envelope = RequestEnvelope.from_raw({
            "session_id": session_id,
            "user_input": text,
            "ui_context": ui_context or self._ui_context_from_wm(session_id),
        })
        record = RunRecord(run_id=envelope.request_id, session_id=session_id,
                           source=source.value)
        self._runs[record.run_id] = record
        self._prune()
        self._roster.run_running(record.run_id, session_id, text)
        self._spawn(record, self._execute_request(record, envelope))
        return record

    async def resume(self, run_id: str, answer: Any) -> RunRecord:
        """Answer the pending interrupt and continue the same run.

        A gated roster verb (#57) uses this exact path: the question is a
        normal confirm interrupt, so the shell's existing ``open`` / approve
        flow answers it too. The approved verb is applied after the decision;
        a denial leaves the work running instead of silently stopping it.
        """
        record = self.get(run_id)
        if record.status != "awaiting_input" or record.interrupt is None:
            raise RunConflict(f"run {run_id} is {record.status}, nothing to resume")
        self._stop_interrupt_watchdog(record)
        if record.pending_verb is not None:
            return await self._decide_verb(record, answer)
        interrupt = record.interrupt
        if interrupt["kind"] == InterruptKind.confirm.value:
            decision = _decision(answer)
            activity = f"user {decision} the action"
            work = self._execute_confirm(record, record.approval_id, decision)
        else:
            text = str(answer or "").strip()
            if not text:
                raise ValueError("a clarify answer must be non-empty text")
            activity = text
            envelope = RequestEnvelope.from_raw({
                "session_id": record.session_id,
                "parent_request_id": record.request_ids[-1],
                "user_input": text,
                "ui_context": self._ui_context_from_wm(record.session_id),
            })
            work = self._execute_request(record, envelope)
        record.interrupt = None
        record.approval_id = None
        self._touch(record, status="running")
        self._roster.run_running(record.run_id, record.session_id, activity)
        self._spawn(record, work)
        return record

    async def cancel(self, run_id: str) -> RunRecord:
        """Stop a run - without asking. With a graph in flight the stop is
        cooperative: the current node - including an in-flight tool call -
        completes first (no half-applied mutation), then the run closes at
        the next node boundary."""
        record = self.get(run_id)
        if record.status in TERMINAL:
            raise RunConflict(f"run {run_id} is already {record.status}")
        # A retry / run_now pass owns one bounded worker call and has no node
        # boundary. Stop it first: otherwise it would write a result or open
        # an approval after this run was closed.
        verb_task = record.verb_task
        if verb_task is not None and not verb_task.done():
            verb_task.cancel()
            await asyncio.wait({verb_task}, timeout=_CANCEL_WAIT_SECONDS)
            record.verb_task = None
            record.verb_task_id = None
            self._reject_verb_approvals(record)
        task = record.task
        if task is not None and not task.done():
            if record.active_thread is not None:
                # Cooperative stop: the current node - with any in-flight
                # tool call - completes first, then the run closes at the
                # next boundary. No prompt: a completed call is a safe call.
                self._engine.run_gate.request(record.active_thread, "cancel")
                await self._await_status(record, {"cancelled"}, timeout=_CANCEL_WAIT_SECONDS)
                if record.status == "cancelled":
                    return record
            # No graph in flight (a resumed worker pass owns one bounded
            # call), or the cooperative stop missed its bound: stop hard.
            # The started execution keeps its row without a receipt, so a
            # retry reconciles as unknown_outcome instead of re-running.
            task.cancel()
            await asyncio.wait({task}, timeout=_CANCEL_WAIT_SECONDS)
            if record.status not in TERMINAL:
                # The task is gone (or missed its bound): never answer 202
                # with a run that is still live.
                self._finish_cancelled(record)
            return record
        # Paused on an interrupt (or a cooperative pause): close the pending
        # approval so it cannot be approved later from another surface.
        self._stop_interrupt_watchdog(record)
        if record.approval_id:
            self._engine.approver.decide(record.approval_id, "rejected",
                                         record.session_id)
        self._finish_cancelled(record)
        return record

    async def cancel_task(self, agent_id: str) -> RunRecord:
        """Stop one task's bounded worker pass without closing its run.

        A ``retry`` / ``run_now`` pass owns its own asyncio task, so it can be
        stopped on its own; the run stays where it was (paused). Work already
        dispatched by the main graph has no per-task node boundary, so that
        case is a typed 409 - only its run can be stopped honestly. A started
        tool call keeps its row without a receipt, so a retry reconciles as
        ``unknown_outcome`` instead of re-running the side effect.
        """
        row = self._roster.get(agent_id)
        if row is None:
            raise RunNotFound(agent_id)
        if row["role"] == SUPERVISOR_ROLE:
            raise RunConflict(f"{agent_id} is the supervisor; cancel its run instead")
        if row["status"] not in ("running", "waiting"):
            raise RunConflict(
                f"{agent_id} is {row['status']}; only running or waiting work can be cancelled")
        record = self.get(row["owner_run_id"])
        if record.status in TERMINAL:
            raise RunConflict(f"run {record.run_id} is {record.status}")
        if not self.task_pass_in_flight(record, agent_id):
            raise RunConflict(
                f"{agent_id} is dispatched by its supervisor's graph; cancel the run to stop it")
        worker = record.verb_task
        assert worker is not None
        worker.cancel()
        await asyncio.wait({worker}, timeout=_CANCEL_WAIT_SECONDS)
        record.verb_task = None
        record.verb_task_id = None
        adopted = self._reject_task_approvals(record, agent_id)
        if record.status == "awaiting_input":
            self._stop_interrupt_watchdog(record)
            record.approval_id = None
            record.interrupt = None
            self._touch(record, status="paused")
            self._roster.run_paused(record.run_id,
                                    f"{agent_id} cancelled by the user" if adopted
                                    else "cancel approved")
        self._engine.repos.tasks.set_status(agent_id, "skipped")
        self._roster.task_cancelled(agent_id)
        return record

    # ------------------------------------------------------------------
    # Roster verbs (issue #57)
    # ------------------------------------------------------------------

    def pause(self, run_id: str) -> RunRecord:
        """Request a cooperative pause. The run halts at the next node
        boundary - the current node, with any in-flight tool call, always
        completes first - and ``resume`` continues it from its checkpoint."""
        record = self.get(run_id)
        if record.status != "running" or record.active_thread is None:
            raise RunConflict(
                f"run {run_id} is {record.status}; only a run with its graph in flight can pause")
        self._engine.run_gate.request(record.active_thread, "pause")
        return record

    def resume_paused(self, run_id: str) -> RunRecord:
        """Continue a paused run from its checkpoint (not the interrupt
        answer; that is ``resume``)."""
        record = self.get(run_id)
        if record.status != "paused":
            raise RunConflict(f"run {run_id} is {record.status}; only a paused run can resume")
        self._reject_busy_verb(record)
        thread = record.request_ids[-1]
        self._engine.run_gate.clear(thread)
        work = self._execute_continuation(record, thread)
        self._touch(record, status="running")
        self._roster.run_running(record.run_id, record.session_id, "resumed by the user")
        self._spawn(record, work)
        return record

    # -- policy gate for roster verbs (#57) -------------------------------

    @staticmethod
    def task_pass_in_flight(record: RunRecord, agent_id: str) -> bool:
        """Whether a standalone retry / run_now pass is owned by this task.
        Graph-dispatched work has no separate handle and can only be stopped
        through its run."""
        return (record.verb_task is not None and not record.verb_task.done()
                and record.verb_task_id == agent_id)

    def mutating_work_in_flight(self, record: RunRecord,
                                agent_id: Optional[str] = None) -> bool:
        """A stored proposal counts when its tool needed approval and the
        gateway owns it (``proposed`` until the receipt lands, then
        ``executed``). Planned and finished work cannot be half-applied by a
        stop. ``agent_id`` narrows the question to one task's pass, which is
        what a task-row cancel stops."""
        for request_id in record.request_ids:
            for row in self._engine.repos.proposals.list_for_request(request_id):
                if agent_id is not None and row["task_id"] != agent_id:
                    continue
                if row["status"] not in ("proposed", "executed"):
                    continue
                task_row = self._roster.get(row["task_id"] or "")
                if task_row is not None and task_row["status"] not in ("running", "waiting"):
                    continue  # the tool already settled; stopping it changes nothing
                try:
                    proposal = ToolProposal.model_validate(json.loads(row["payload"]))
                except (TypeError, ValueError):
                    continue
                if self._engine.policy.proposal_requires_approval(proposal):
                    return True
        return False

    def request_verb_approval(
        self, record: RunRecord, verb: str, agent_id: str, reason: str
    ) -> RunRecord:
        """Ask a roster verb's decision through the run's C5 interrupt path.

        The approval is created by the same approval service task proposals
        use, so it has one expiry, one ``run.interrupt``, and one ``resume``
        answer. ``resume`` now recognizes it as a verb question and applies
        the verb only after the human says yes.
        """
        if record.approval_id is not None:
            raise RunConflict("the run is already waiting on a decision")
        summary = f"Allow {verb} on {agent_id}: {reason}"
        approval = _verb_approval(
            proposal_id=f"verb:{verb}:{agent_id}:{record.run_id}",
            fingerprint=f"{verb}:{agent_id}:{record.run_id}",
            summary=summary,
            ttl_seconds=self._engine.settings.approval_ttl_seconds,
        )
        self._engine.approver.create(approval, record.session_id)
        record.approval_id = approval.approval_id
        record.pending_verb = {
            "approval_id": approval.approval_id,
            "verb": verb,
            "agent_id": agent_id,
        }
        record.interrupt = {
            "kind": InterruptKind.confirm.value,
            "message": summary,
            "options": ["yes", "no"],
        }
        record.escalations = 0
        self._touch(record, status="awaiting_input")
        self._roster.run_waiting(record.run_id, summary)
        self._set_state(record, AgentState.waiting)
        self._publish(record, EventType.run_interrupt, record.interrupt)
        self._start_interrupt_watchdog(record)
        return record

    async def _decide_verb(self, record: RunRecord, answer: Any) -> RunRecord:
        pending = dict(record.pending_verb or {})
        decision = _decision(answer)
        ok, reason = self._engine.approver.decide(
            pending.get("approval_id"), decision, record.session_id
        )
        if not ok:
            raise RunConflict(reason)
        record.pending_verb = None
        record.approval_id = None
        record.interrupt = None
        if decision == "rejected":
            verb = pending.get("verb", "verb")
            self._touch(record, status="running")
            self._roster.run_running(record.run_id, record.session_id,
                                     f"{verb} denied by the user")
            self._set_state(record, AgentState.idle)
            return record
        return await self._apply_approved_verb(
            record, pending.get("verb"), pending.get("agent_id")
        )

    async def _apply_approved_verb(
        self, record: RunRecord, verb: Optional[str], agent_id: Optional[str]
    ) -> RunRecord:
        if verb == "cancel":
            row = self._roster.get(agent_id or "")
            if row is not None and row["role"] != SUPERVISOR_ROLE:
                return await self.cancel_task(agent_id or "")
            return await self.cancel(record.run_id)
        if verb == "pause":
            return self.pause(record.run_id)
        if verb == "resume":
            return self.resume_paused(record.run_id)
        if verb == "retry":
            row = self._roster.get(agent_id or "")
            if row is not None and row["role"] == SUPERVISOR_ROLE:
                return self.retry_run(record.run_id)
            return self.retry_task(agent_id or "")
        if verb == "run_now":
            return self.run_now(agent_id or "")
        raise RunConflict(f"unknown roster verb {verb}")

    def retry_run(self, run_id: str) -> RunRecord:
        """A failed run retries as a new run of the same request; every
        proposal and approval is evaluated afresh."""
        record = self.get(run_id)
        if record.status != "failed":
            raise RunConflict(f"run {run_id} is {record.status}; only a failed run can retry")
        text = self._engine.envelope_for(record.request_ids[0]).user_input
        return self.start(text, record.session_id, Source.ui)

    def retry_task(self, agent_id: str) -> RunRecord:
        """Retry one failed task agent: a fresh bounded worker pass over the
        same packet (attempt + 1, new idempotency key). Policy re-applies, so
        approval-bound work asks again; the roster row reports the new pass.
        The owning run must be paused - a run in flight owns its dispatch."""
        row = self._roster.get(agent_id)
        if row is None:
            raise RunNotFound(agent_id)
        if row["status"] != "error":
            raise RunConflict(f"{agent_id} is {row['status']}; only a failed task can retry")
        record = self.get(row["owner_run_id"])
        if record.status in TERMINAL:
            raise RunConflict(f"run {record.run_id} is {record.status}; retry the run instead")
        if record.status != "paused":
            # An awaiting-input run has no thread to gate and no place to put
            # this pass's own question: its pending interrupt owns the answer.
            raise RunConflict(
                f"run {record.run_id} is {record.status}; pause it before retrying a task")
        self._reject_busy_verb(record)
        if record.active_thread is not None:
            raise RunConflict("the run is dispatching its own work; pause it before retrying a task")
        task_row = self._engine.repos.tasks.get(agent_id)
        if task_row is None:
            raise RunNotFound(f"task {agent_id} is not in storage")
        packet = TaskPacket.model_validate(json.loads(task_row["payload"]))
        attempt = packet.attempt + 1
        if attempt > packet.scope.max_steps:
            raise RunConflict(
                f"attempt {attempt} exceeds the task's step limit {packet.scope.max_steps}")
        retried = packet.model_copy(update={
            "attempt": attempt,
            "idempotency_key": f"{packet.idempotency_key}:retry{attempt}",
        })
        self._engine.repos.tasks.create(retried, status="running")
        self._spawn_worker(record, retried)
        return record

    def run_now(self, agent_id: str) -> RunRecord:
        """Start one planned (idle) task agent now: a bounded worker pass in
        the background, dispatched only when the task's own dependencies are
        satisfied. If the pass needs a human, the paused run takes its
        interrupt, so the ask stays answerable."""
        row = self._roster.get(agent_id)
        if row is None:
            raise RunNotFound(agent_id)
        if row["status"] != "idle":
            raise RunConflict(f"{agent_id} is {row['status']}; only planned work can run now")
        record = self.get(row["owner_run_id"])
        if record.status in TERMINAL:
            raise RunConflict(f"run {record.run_id} is {record.status}; its planned work can no longer start")
        self._reject_busy_verb(record)
        if record.status != "paused":
            raise RunConflict(
                f"run {record.run_id} is {record.status}; pause it before starting planned work")
        if record.approval_id is not None:
            raise RunConflict("the run is already waiting on a decision")
        task_row = self._engine.repos.tasks.get(agent_id)
        if task_row is None:
            raise RunNotFound(f"task {agent_id} is not in storage")
        packet = TaskPacket.model_validate(json.loads(task_row["payload"]))
        pending = [ref for ref in packet.input_refs
                   if ref.startswith("task:") and not self._dep_satisfied(ref)]
        if pending:
            raise RunConflict(f"{agent_id} still waits on {', '.join(pending)}")
        # Own the packet before the pass starts: until the worker reports its
        # own status, the graph must not see this task as idle/dispatchable.
        self._engine.repos.tasks.set_status(agent_id, "running")
        self._spawn_worker(record, packet)
        return record

    # ------------------------------------------------------------------
    # Background execution
    # ------------------------------------------------------------------

    def _spawn(self, record: RunRecord, work: Any) -> None:
        record.task = asyncio.create_task(self._guard(record, work))

    async def _guard(self, record: RunRecord, work: Any) -> None:
        current_session_id.set(record.session_id)  # task-local copy
        current_run_id.set(record.run_id)
        try:
            await work
        except asyncio.CancelledError:
            self._finish_cancelled(record)
        except Exception as error:  # engine bug: surface it, keep the server up
            gate = gate_error_of(error)
            if isinstance(gate, RunPaused):
                self._finish_paused(record)
            elif isinstance(gate, RunCancelled):
                self._finish_cancelled(record)
            else:
                self._fail(record, "ENGINE_FAILURE", f"engine failure: {error}")

    async def _execute_request(self, record: RunRecord, envelope: RequestEnvelope) -> None:
        async with self._graph_lock:
            await self._engine.ensure_main_graph()
        record.request_ids.append(envelope.request_id)
        self._touch(record, status="running")
        record.active_thread = envelope.request_id
        try:
            result = await self._engine.handle_request(
                envelope, on_graph_event=self._graph_observer(record)
            )
            self._settle(record, result)
        finally:
            record.active_thread = None
            self._engine.run_gate.clear(envelope.request_id)

    async def _execute_continuation(self, record: RunRecord, request_id: str) -> None:
        """Continue the paused run's graph from its checkpoint (#57)."""
        async with self._graph_lock:
            await self._engine.ensure_main_graph()
        self._touch(record, status="running")
        record.active_thread = request_id
        try:
            result = await self._engine.continue_request(
                request_id, on_graph_event=self._graph_observer(record)
            )
            self._settle(record, result)
        finally:
            record.active_thread = None
            self._engine.run_gate.clear(request_id)

    async def _execute_confirm(self, record: RunRecord, approval_id: str, decision: str) -> None:
        self._set_state(record, AgentState.acting if decision == "approved"
                        else AgentState.thinking)
        result = await self._engine.resume_after_decision(
            approval_id, decision, record.session_id
        )
        record.request_ids.append(result.request_id)
        self._settle(record, result)

    def _graph_observer(self, record: RunRecord):
        async def observe(kind: str, node: str, update: Optional[dict[str, Any]]) -> None:
            if kind == "node_started":
                state = NODE_AGENT_STATE.get(node)
                if state is not None:
                    self._set_state(record, state)
            elif kind == "node_finished" and node in PLAN_NODES:
                self._roster.tasks_planned(record.run_id, record.session_id,
                                           self._packets((update or {}).get("task_ids")))
            elif kind == "node_finished" and node in RESULT_NODES:
                for result in (update or {}).get("results") or []:
                    progress = self._task_progress(record, result)
                    if progress is not None:
                        self._publish(record, EventType.task_progress, progress)
        return observe

    # ------------------------------------------------------------------
    # Outcomes
    # ------------------------------------------------------------------

    def _settle(self, record: RunRecord, result: CoreRequestResult) -> None:
        if record.status in TERMINAL:
            return  # a verb already closed the run; its word stands
        record.route = result.route or record.route
        record.errors = [error.model_dump(mode="json") for error in result.errors]
        if result.pending_approval is not None:
            approval = result.pending_approval
            record.approval_id = approval["approval_id"]
            self._pause(record, {
                "kind": InterruptKind.confirm.value,
                "message": approval["summary"],
                "options": ["yes", "no"],
            })
        elif result.route == "clarify" and result.status == "completed":
            self._pause(record, {
                "kind": InterruptKind.clarify.value,
                "message": result.response_text,
                "options": [],
            })
        elif result.status == "failed":
            first = result.errors[0] if result.errors else None
            self._fail(record, first.code.value if first else "ENGINE_FAILURE",
                       first.message if first else (result.response_text or "request failed"))
        else:
            self._complete(record, result)

    def _pause(self, record: RunRecord, interrupt: dict[str, Any]) -> None:
        record.interrupt = interrupt
        record.escalations = 0  # the budget is per interrupt, not per run
        self._touch(record, status="awaiting_input")
        self._roster.run_waiting(record.run_id, interrupt["message"])
        self._set_state(record, AgentState.waiting)
        self._publish(record, EventType.run_interrupt, interrupt)
        self._start_interrupt_watchdog(record)

    def _finish_paused(self, record: RunRecord) -> None:
        """The graph halted at a node boundary after a pause request (#57).
        The current node had already completed, so nothing is half-applied."""
        thread = record.active_thread
        record.active_thread = None
        if thread is not None:
            self._engine.run_gate.clear(thread)
        self._touch(record, status="paused")
        self._roster.run_paused(record.run_id, "paused by the user")

    def _complete(self, record: RunRecord, result: CoreRequestResult) -> None:
        # The engine has no widget producers yet; web/tool results will add them.
        record.pending_verb = None
        record.response = {"speech": result.response_text, "widgets": []}
        self._touch(record, status="completed")
        self._publish(record, EventType.run_response, dict(record.response))
        # Diagram step 22: speaking -> idle (the shell times it to playback).
        if result.response_text:
            self._set_state(record, AgentState.speaking)
        self._set_state(record, AgentState.idle)
        self._roster.run_finished(record.run_id, AgentStatus.done,
                                  result.response_text or "completed")
        self._publish(record, EventType.run_completed, {"status": RunOutcome.ok.value})

    def _fail(self, record: RunRecord, code: str, message: str) -> None:
        self._stop_interrupt_watchdog(record)
        record.pending_verb = None
        self._touch(record, status="failed")
        self._publish(record, EventType.run_error, api_error(code, message))
        if not record.errors:
            record.errors = [api_error(code, message)["error"]]
        self._set_state(record, AgentState.error)
        self._roster.run_finished(record.run_id, AgentStatus.error, message)
        self._publish(record, EventType.run_completed, {"status": RunOutcome.failed.value})

    def _finish_cancelled(self, record: RunRecord) -> None:
        if record.status in TERMINAL:
            return
        self._stop_interrupt_watchdog(record)
        record.interrupt = None
        record.approval_id = None
        record.pending_verb = None
        self._touch(record, status="cancelled")
        if record.request_ids:
            self._engine.repos.requests.set_status(record.request_ids[-1], "cancelled")
        self._set_state(record, AgentState.idle)
        self._roster.run_finished(record.run_id, AgentStatus.done, "cancelled")
        self._publish(record, EventType.run_completed, {"status": RunOutcome.cancelled.value})

    # ------------------------------------------------------------------
    # Roster verb helpers (issue #57) and the interrupt watchdog (#58)
    # ------------------------------------------------------------------

    def _dep_satisfied(self, dep_ref: str) -> bool:
        """A ``task:`` dependency counts only from its persisted record."""
        row = self._engine.repos.tasks.get(dep_ref)
        return row is not None and row["status"] in ("executed", "succeeded", "completed")

    @staticmethod
    def _reject_busy_verb(record: RunRecord) -> None:
        """One retry / run_now pass per run: a second verb would dispatch the
        same packet twice before the first pass can update the roster."""
        if record.verb_task is not None and not record.verb_task.done():
            raise RunConflict("a worker pass is already in flight")

    def _reject_verb_approvals(self, record: RunRecord) -> None:
        """Close asks a stopped worker pass may already have opened. Only
        this run's tasks are touched: other runs share the session."""
        for row in self._engine.repos.approvals.list_pending_for_session(record.session_id):
            proposal = self._engine.repos.proposals.get(row["proposal_id"])
            if proposal is None:
                continue
            task_row = self._roster.get(proposal.get("task_id") or "")
            if task_row is not None and task_row["owner_run_id"] == record.run_id:
                self._engine.approver.decide(row["approval_id"], "rejected",
                                             record.session_id)

    def _reject_task_approvals(self, record: RunRecord, agent_id: str) -> bool:
        """Close only this task's pending asks (a sibling may be waiting in
        the same session). True when the run had adopted one of them."""
        adopted = False
        for row in self._engine.repos.approvals.list_pending_for_session(record.session_id):
            proposal = self._engine.repos.proposals.get(row["proposal_id"])
            if proposal is None or proposal.get("task_id") != agent_id:
                continue
            if record.approval_id == row["approval_id"]:
                adopted = True
            self._engine.approver.decide(row["approval_id"], "rejected",
                                         record.session_id)
        return adopted

    async def _await_status(self, record: RunRecord, statuses: set[str],
                            timeout: float) -> None:
        """Poll until the run reaches one of ``statuses`` (or a terminal
        state, or the bound). Cooperative stops are not instant: the current
        node finishes first."""
        loop = asyncio.get_event_loop()
        deadline = loop.time() + timeout
        while record.status not in statuses and record.status not in TERMINAL:
            if loop.time() >= deadline:
                return
            await asyncio.sleep(0.02)

    def _spawn_worker(self, record: RunRecord, packet: TaskPacket) -> None:
        """One bounded worker pass in the background (retry / run now). The
        roster reports it through the existing worker listener; a pass that
        needs a human hands its interrupt to the paused run, so the ask
        stays answerable through the run's ``resume``."""
        async def work() -> None:
            current_session_id.set(record.session_id)
            current_run_id.set(record.run_id)
            try:
                worker_run = await self._engine.worker.run(
                    packet, packet.request_id, record.session_id
                )
            except Exception:
                # The row fails but the run stays paused on purpose: a paused
                # run is exactly what retry_task needs to re-run just this
                # packet. Failing the run here would take that verb away.
                self._engine.repos.tasks.set_status(packet.task_id, "failed")
                self._roster.on_worker("finished", packet, None)
                return
            finally:
                record.verb_task = None
                record.verb_task_id = None
            result = worker_run.result
            if result is not None:
                self._engine.repos.tasks.set_status(packet.task_id, result.status.value)
            if (result is not None and result.status == AgentResultStatus.needs_input
                    and worker_run.approval is not None):
                self._adopt_worker_interrupt(record, worker_run.approval)

        # The record keeps the task reference: the loop only holds weak
        # ones, and a pass that disappears would leave the row dishonest.
        record.verb_task_id = packet.task_id
        record.verb_task = asyncio.create_task(work())

    def _adopt_worker_interrupt(self, record: RunRecord, approval: Any) -> None:
        """A verb-started pass needs a human: the paused run takes the
        interrupt (only when it has no other question pending)."""
        if record.status != "paused" or record.approval_id is not None:
            return
        record.escalations = 0  # the budget is per interrupt, not per run
        record.approval_id = approval.approval_id
        record.interrupt = {
            "kind": InterruptKind.confirm.value,
            "message": approval.summary,
            "options": ["yes", "no"],
        }
        self._touch(record, status="awaiting_input")
        self._roster.run_waiting(record.run_id, record.interrupt["message"])
        self._set_state(record, AgentState.waiting)
        self._publish(record, EventType.run_interrupt, record.interrupt)
        self._start_interrupt_watchdog(record)

    # -- interrupt timeout policy (#58) ---------------------------------

    def _start_interrupt_watchdog(self, record: RunRecord) -> None:
        """Watch a pending approval's expiry. Clarify interrupts have no
        approval and no timeout: the orb owns that ask."""
        self._stop_interrupt_watchdog(record)
        if record.approval_id is None:
            return
        record.interrupt_watchdog = asyncio.create_task(
            self._watch_interrupt(record, record.approval_id)
        )

    def _stop_interrupt_watchdog(self, record: RunRecord) -> None:
        watchdog = record.interrupt_watchdog
        record.interrupt_watchdog = None
        if watchdog is not None and not watchdog.done():
            if watchdog is not asyncio.current_task():
                watchdog.cancel()

    async def _watch_interrupt(self, record: RunRecord, approval_id: str) -> None:
        row = self._engine.repos.approvals.get(approval_id)
        delay = _seconds_until(row["expires_at"]) if row is not None else 0.0
        await asyncio.sleep(max(0.0, delay))
        if record.status != "awaiting_input" or record.approval_id != approval_id:
            return  # answered, superseded, or the run moved on
        settings = self._engine.settings
        if (settings.interrupt_timeout_policy == "escalate"
                and record.escalations < settings.interrupt_max_escalations):
            self._escalate_interrupt(record)
            return
        self._deny_interrupt(record)

    def _escalate_interrupt(self, record: RunRecord) -> None:
        """Re-issue the ask with a fresh expiry and nudge the orb (#58): the
        interrupt is republished and the avatar shows its error state."""
        prior_approval_id = record.approval_id
        old = self._engine.repos.approvals.get(prior_approval_id)
        if old is not None:
            self._engine.repos.approvals.decide(
                prior_approval_id, ApprovalStatus.expired.value)
        approval = _verb_approval(
            proposal_id=old["proposal_id"] if old else f"escalate:{record.run_id}",
            fingerprint=old["proposal_fingerprint"] if old else f"escalate:{record.run_id}",
            summary=record.interrupt["message"] if record.interrupt else "a decision is still needed",
            ttl_seconds=self._engine.settings.approval_ttl_seconds,
        )
        self._engine.approver.create(approval, record.session_id)
        record.approval_id = approval.approval_id
        if (record.pending_verb is not None
                and record.pending_verb.get("approval_id") == prior_approval_id):
            record.pending_verb["approval_id"] = approval.approval_id
        record.escalations += 1
        self._set_state(record, AgentState.error)
        self._publish(record, EventType.run_interrupt, record.interrupt)
        self._start_interrupt_watchdog(record)

    def _deny_interrupt(self, record: RunRecord) -> None:
        """Auto-deny (#58): an interrupt left unheard past its expiry fails
        the run cleanly - the row shows why, nothing re-asks."""
        approval_id, record.approval_id = record.approval_id, None
        record.interrupt = None
        record.pending_verb = None
        if approval_id is not None:
            self._engine.approver.decide(approval_id, "rejected", record.session_id)
            row = self._engine.repos.approvals.get(approval_id)
            if row is not None:
                proposal_row = self._engine.repos.proposals.get(row["proposal_id"])
                if proposal_row is not None and proposal_row.get("task_id"):
                    self._engine.repos.tasks.set_status(proposal_row["task_id"], "failed")
        self._fail(record, "APPROVAL_EXPIRED",
                   "the approval timed out and was denied automatically")

    # ------------------------------------------------------------------
    # Small helpers
    # ------------------------------------------------------------------

    def _publish(self, record: RunRecord, event_type: EventType, data: dict[str, Any]) -> None:
        self._hub.publish(record.session_id, event_type, data, run_id=record.run_id)

    def _set_state(self, record: RunRecord, state: AgentState) -> None:
        if record.agent_state == state.value:
            return
        record.agent_state = state.value
        self._publish(record, EventType.agent_state, {"state": state.value})

    def _task_progress(self, record: RunRecord, result: Any) -> Optional[dict[str, Any]]:
        """C9 AgentResult -> ``task.progress {task_id, tool_id, status}``.
        ``tool_id`` is the tool the task proposed (None if it called none)."""
        data = result.model_dump(mode="json") if hasattr(result, "model_dump") else dict(result)
        status = RESULT_TASK_STATUS.get(str(data.get("status")))
        if status is None:
            return None
        task_id = data.get("task_id")
        tool_id = None
        if record.request_ids:
            for row in self._engine.repos.proposals.list_for_request(record.request_ids[-1]):
                if row["task_id"] == task_id:
                    tool_id = row["tool_id"]
        return {"task_id": task_id, "tool_id": tool_id, "status": status.value}

    def _packets(self, task_ids: Any) -> list[TaskPacket]:
        packets = []
        for task_id in task_ids or []:
            row = self._engine.repos.tasks.get(task_id)
            if row is not None:
                packets.append(TaskPacket.model_validate(json.loads(row["payload"])))
        return packets

    @staticmethod
    def _touch(record: RunRecord, status: str) -> None:
        record.status = status
        record.updated_at = utc_now_iso()

    def _ui_context_from_wm(self, session_id: str) -> dict[str, Any]:
        """Default C1 ui_context from the shell's latest ``wm.state``."""
        wm = self._hub.wm_state(session_id) or {}
        focused = wm.get("focused_app_id")
        return {"active_surface": focused} if isinstance(focused, str) and focused else {}

    def _prune(self) -> None:
        finished = [run_id for run_id, record in self._runs.items() if record.status in TERMINAL]
        for run_id in finished[: max(0, len(finished) - _MAX_FINISHED_RUNS)]:
            del self._runs[run_id]
            self._roster.forget_run(run_id)


def _decision(answer: Any) -> str:
    if isinstance(answer, bool):
        return "approved" if answer else "rejected"
    lowered = str(answer or "").strip().lower()
    if lowered in _YES:
        return "approved"
    if lowered in _NO:
        return "rejected"
    raise ValueError("a confirm answer must be yes or no")


def _seconds_until(expires_at: str) -> float:
    """Seconds from now until an approval's ``expires_at`` (ISO, UTC)."""
    try:
        expiry = datetime.strptime(expires_at, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, (expiry - datetime.now(timezone.utc)).total_seconds())


def _verb_approval(proposal_id: str, fingerprint: str, summary: str,
                   ttl_seconds: int) -> ApprovalRequest:
    """A pending approval for a roster verb decision (#57) or a re-issued
    interrupt (#58): same C5 shape, bound to its own fingerprint."""
    return ApprovalRequest(
        approval_id=f"approval:{secrets.token_hex(16)}",
        proposal_id=proposal_id,
        proposal_fingerprint=fingerprint,
        summary=summary[:200],
        status=ApprovalStatus.pending,
        created_at=utc_now_iso(),
        expires_at=(datetime.now(timezone.utc).replace(microsecond=0)
                    + timedelta(seconds=ttl_seconds)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )

