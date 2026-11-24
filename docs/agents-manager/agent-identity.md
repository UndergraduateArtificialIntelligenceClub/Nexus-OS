# Agent identity contract (engine)

Status: **implemented** (issue #54). Answers Q1 of [concepts.md](concepts.md).

Every agent the engine runs has a stable identity and an honest status, so
any UI (the roster widget, #55; orb dressing, #56) can answer *"what is this
agent doing, for whom, since when?"*.

- Code: `apps/engine/backend/api/agents.py` (`AgentRoster`), wired in
  `api/runs.py` and `api/routes.py`; wire vocabulary in `api/events.py`.
- TypeScript mirror: `AgentIdentity`, `AgentStatus` and `AgentUpdatedEvent` in
  `apps/shell/frontend/src/types/agentEvents.ts`; `engineClient.listAgents()`.
- Tests: `tests/systems/test_agents_api.py`.
- Consumer: the roster widget, [roster-widget.md](roster-widget.md).

## Which agents exist

Each `/api/v1` run produces:

| Agent | `agent_id` | `role` | `label` |
|---|---|---|---|
| The main graph working on the run (every route, including fast and clarify) | `supervisor:<run_id>` | `supervisor` | `supervisor` |
| One bounded worker pass per task packet | the task id (`task:<request_id>:...`) | the packet's `assigned_to`: `discovery`, `knowledge`, `desktop`, `recipe` | the task objective (max 60 chars) |

A run that continues after a clarify answer keeps the same `run_id`, so new
task agents from the follow-up request still have the same `owner_run_id`.

## Shape

Sent as `agent.updated` data and returned by `GET /api/v1/agents`:

```json
{
  "agent_id": "task:1f0c...:direct",
  "role": "recipe",
  "label": "Open application browser",
  "status": "waiting",
  "since": "2026-11-21T15:20:04Z",
  "owner_run_id": "1f0c...",
  "last_activity": "Allow open_application (reversible_write) targeting app:browser",
  "updated_at": "2026-11-21T15:20:04Z"
}
```

| Field | Meaning |
|---|---|
| `agent_id` | Stable for the agent's lifetime; key for upserts |
| `role` | See the table above |
| `label` | Short display name |
| `status` | `idle`, `running`, `waiting`, `done`, `error` |
| `since` | When the **current status** began. Elapsed time = now − `since` |
| `owner_run_id` | The run the agent works for. Every agent belongs to exactly one run |
| `last_activity` | Short text (max 200 chars): what it is doing now, or how it ended |
| `updated_at` | Last change of status or activity |

## Statuses

| Status | Meaning |
|---|---|
| `idle` | Known but not started. Planned tasks wait here until their `task:` dependencies finish |
| `running` | Actually executing (supervisor: the graph is running; worker: the worker pass is running) |
| `waiting` | Blocked on a human decision: a pending approval (confirm) or a clarify question. Nothing else is `waiting` |
| `done` | Finished; see `last_activity` for how |
| `error` | A real failure: failed tool or receipt, policy denial, engine failure, or an unverifiable side effect (`unknown_outcome`) |

`agent.state` (the avatar) and `agent.updated` (the roster) are separate on
purpose: the avatar is one face, the roster lists the hands.

## Status mapping

### Supervisor (one per run)

| Run event | Status | `last_activity` |
|---|---|---|
| Run created (`POST /agent/runs`) | `running` | the user's request |
| Run pauses on `run.interrupt` (confirm or clarify) | `waiting` | the interrupt message |
| Run resumed | `running` | `user approved the action`, `user rejected the action`, or the clarify answer |
| Run completed | `done` | the spoken response |
| Run failed | `error` | the error message |
| Run cancelled | `done` | `cancelled` |

### Workers (discovery, knowledge, desktop, recipe)

All worker roles use the same mapping. It comes from the worker pass and its
C9 `AgentResult`, the same object that feeds `task.progress`:

| Fact | Status | `last_activity` |
|---|---|---|
| Packet created by `supervisor_plan` / `bounded_replan` | `idle` | `planned` |
| Worker pass starts (`TaskWorker.add_listener` "started") | `running` | the task objective |
| Result `completed` | `done` | result summary |
| Result `needs_input` (policy created an approval) | `waiting` | approval summary |
| Result `failed` | `error` | result summary |
| Result `blocked` (receipt `unknown_outcome`) | `error` | result summary |

When an approval is answered, the same task runs a new worker pass, so it
goes `waiting → running → done | error`.

Fast-route tasks skip planning, so they appear directly as `running`.
Today `discovery` and `knowledge` come from supervised plans, and direct
desktop actions use the `recipe` role; `desktop` follows the same mapping
once plans assign it.

### When the run ends

Worker agents that are still open cannot progress, so they are closed with a
reason instead of looking alive:

| Worker was | Run completed | Run failed | Run cancelled |
|---|---|---|---|
| `idle` | `done`, `not started: the run ended first` | same | same |
| `running` / `waiting` | `done` | `error` (run error message) | `done`, `cancelled` |

## Events and catch-up

- Every change publishes `agent.updated` to the run's session socket, with
  `run_id` = `owner_run_id`. An agent's first event is its creation.
- `GET /api/v1/agents?session_id={uuid}` returns `{"agents": [...]}` in
  creation order. Without `session_id` it returns all sessions. Use it on
  connect and after a reconnect; events are dropped while no socket is open.

## Limits and decisions

- **In memory.** The roster lives in the API process and keeps the agents of
  the runs `RunManager` keeps (last 200 finished runs). It is empty after a
  restart; tasks, approvals and receipts stay durable in SQLite.
- **Only `/api/v1` runs.** Requests through the legacy `POST /agent/requests`
  route have no run and do not appear.
- **Cancelled is `done`.** The status set has no `cancelled`; a cancelled
  agent is `done` with `last_activity: "cancelled"`. Adding a status is a
  contract change for #55.
- **Rejecting an approval asks again.** Existing engine behavior, not part of
  this contract: after `resume: "no"` the worker runs again and policy creates
  a new approval, so the task goes back to `waiting`. The roster reports this
  as it happens. Fixing the reject path belongs with #58
  (interrupt → deny → clean failure).
- **No verbs yet.** pause / resume / cancel / retry per agent are #57; this
  contract is read-only.
