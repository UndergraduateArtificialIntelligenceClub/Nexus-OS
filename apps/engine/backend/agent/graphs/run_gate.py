"""Cooperative run stop requests (issue #57).

A pause or cancel is a *request*, not an interruption: the main graph checks
the gate at every node boundary, so the node that is currently running -
including an in-flight tool call - always completes first. No mutation is
left half-applied, and the checkpointer already holds the state at the last
completed node, so a paused run continues from exactly there.

The gate is per ``request_id`` (the LangGraph thread id): the API layer
requests the stop, the graph observes it, and the run manager consumes it
(``api/runs.py``).
"""

from __future__ import annotations

from typing import Dict


class RunPaused(Exception):
    """Raised at a node boundary after a pause was requested: the current
    node completed; the run halts and waits for ``resume``."""


class RunCancelled(Exception):
    """Raised at a node boundary after a cooperative cancel: the current
    node completed; the run closes as cancelled."""


class RunGate:
    """Per-thread stop requests. One verb at a time per run; setting a new
    verb replaces the previous one (a cancel supersedes a pause)."""

    def __init__(self) -> None:
        self._requested: Dict[str, str] = {}

    def request(self, request_id: str, verb: str) -> None:
        """Record a stop request for the next node boundary."""
        if verb not in ("pause", "cancel"):
            raise ValueError(f"unknown run gate verb: {verb}")
        self._requested[request_id] = verb

    def clear(self, request_id: str) -> None:
        """Consume or drop a stop request (the run answered it, moved on, or ended)."""
        self._requested.pop(request_id, None)

    def check(self, request_id: str) -> None:
        """Raise :class:`RunPaused` / :class:`RunCancelled` when a stop was
        requested. Called at node entry by the main graph."""
        verb = self._requested.get(request_id)
        if verb == "pause":
            raise RunPaused(request_id)
        if verb == "cancel":
            raise RunCancelled(request_id)


def gate_error_of(error: BaseException) -> BaseException | None:
    """Find the gate exception in a raised chain, whatever the graph runtime
    wrapped it in. ``None`` when the error is not a gate stop."""
    cause: BaseException | None = error
    while cause is not None:
        if isinstance(cause, (RunPaused, RunCancelled)):
            return cause
        cause = cause.__cause__ or cause.__context__
    return None
