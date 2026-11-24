# Roster widget (agents manager Level 1)

Status: **implemented** (issue #55). Builds on the Level 0 preview
([plan.md](plan.md), #27) and the engine's agent identity contract
([agent-identity.md](agent-identity.md), #54).

- Code: `apps/shell/frontend/src/internal-apps/agents-manager/frontend/src/`
  (`roster.ts` the data seam, `App.tsx` the widget).
- Registry entry: `agents` in `apps/shell/frontend/src/apps/registry.ts`,
  sizes `2x1`, `2x2` (default), `4x2`, plus fullscreen.

## Row anatomy

One row per engine agent, as in [concepts.md](concepts.md) §2:

```
[glyph status]  label            elapsed
activity                         role
```

- **status** uses the contract's words (`idle`, `running`, `waiting`, `done`,
  `error`). The glyph comes from the AI kit's `AgentStatus`: a spinner for
  `running` and `waiting`, `·` otherwise. Teal marks `running` and `waiting`.
- **elapsed** is now − `since` (time in the current status). `idle` shows `—`.
- **activity** is `last_activity`, verbatim.
- **role** is left out for supervisors, whose label already is their role.
- **actions**: none. Level 1 is read-only; verbs arrive with #57, and only
  for what the engine can perform.

Rows are grouped by run, newest run first. Inside a run they keep the engine's
creation order: the supervisor, then its task agents (indented). Labels repeat
across runs (every supervisor is `supervisor`), so the grouping is what keeps
rows readable.

In `2x2`, `4x2` and fullscreen, a detail pane shows the selected agent's full
activity, agent id and run id.

## Sources

`RosterSource` exposes `snapshot()`, `subscribe()` and `start()`. The widget
calls `start()` on mount and the returned stop function on unmount.

| Source | Used by | Data |
|---|---|---|
| `liveRosterSource()` | the app | `GET /api/v1/agents?session_id=` to catch up, then `agent.updated` events |
| `fixtureRosterSource()` | tests; offline development with `VITE_NEXUS_ROSTER=fixture` | three runs that cover every status, in the contract's exact shape |

The fixture is never a fallback for a lost engine.

### Session

The engine scopes the roster and the event socket by `session_id`. The page's
session id comes from `engineSessionId()` (`shell/agent/engineSession.ts`), and
every engine consumer must use it. Until the shell starts runs through the
engine (#41), the live roster is honestly empty.

### Connection

The live source opens its own socket with `createEngineClient({ observeOnly: true })`.
An observe-only client never sends anything, so it never answers a
`ui.command`; only the shell's own client does. It reconnects with the client's
backoff.

| `connection` | Meaning | UI |
|---|---|---|
| `connecting` | first sync pending | `connecting` badge; "connecting to the engine" when empty |
| `live` | the catch-up list has loaded; events keep rows current | `live` badge (teal) |
| `offline` | the socket dropped or the catch-up failed | frozen rows + banner |

On every (re)connect the source loads the catch-up list again. The list
replaces the roster, so agents the engine no longer knows (after a restart, or
runs it has forgotten) disappear. Events received while the list was loading
win over an older list entry. An event older than the row it updates is
ignored (it was in flight when a newer list arrived).

### Offline: frozen rows, never fake data

When the connection drops, the rows stay as the engine last reported them:

- banner: `engine offline · last known roster from HH:MM:SS` (or
  `engine offline · retrying` when nothing was ever loaded)
- elapsed times stop at the moment the connection dropped
- spinners stop; the status word stays; text turns muted

The roster stays `offline` until the next catch-up list loads.

## Performance (10+ concurrent agents)

- Rows are memoized and keep their object when unchanged. An `agent.updated`
  re-renders only the row it changes.
- A single `Clock` provider ticks once a second. Only the `Elapsed` cells read
  it, so a tick re-renders no row.
- `App.perf.test.tsx` checks both with 12 agents by counting `AgentStatus`
  renders. It fails (12 renders instead of 1) if the row memo is removed.

## AI kit reuse

- `AgentStatus` renders every status glyph and word (with `labels`, so it says
  `running` / `done`, not the orb's conversational words).
- `Badge`, `EmptyState`, `Label`, `Mono`.
- `ActivityTimeline` is **not** used at Level 1. Its vocabulary is
  `task.progress` (`queued` / `running` / `done` / `failed` / `skipped`), which
  has no `waiting`, so a task blocked on approval would show as `running`. The
  contract's task agents are roster rows themselves (grouped under their
  supervisor).

## Review checklist (concepts.md §5)

- [ ] Not a chat surface: no text input, no message list, no replies.
- [ ] Not engine settings: no switches, selects or configuration.
- [ ] Not a permission pop-up factory: no dialog, no approve / deny. Waiting
      agents say what they wait for; answering belongs to `InterruptPanel` (#58).
- [ ] No verb the engine cannot perform: the only buttons are row selection.

`App.test.tsx` asserts these: no textbox, dialog, checkbox or switch, and every
button is a roster row.

## Limits

- **Empty until #41.** The shell does not start runs through the engine yet,
  so the roster has nothing to show in this session.
- **Second socket per session.** The engine's `SessionHub.is_connected()`
  counts the roster's socket. If the shell's main socket is gone but the roster's
  is open, the engine waits for a `ui.command` ack until its timeout instead
  of failing fast. A shared desktop event bus (#45) removes the second socket.
- **No history across reloads.** The session id is per page load, so a reload
  starts an empty roster.
- **Every finished run stays listed** until the engine forgets it (its last 200
  finished runs).
