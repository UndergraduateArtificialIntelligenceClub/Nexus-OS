# Agents Manager — Level 0 Plan

Status: **Level 0 preview implemented** in
`apps/shell/frontend/src/internal-apps/agents-manager/`.

Companion to [`concepts.md`](./concepts.md), which keeps the original duty-roster
ideas and the open questions for the Agent team.

Issue: [#27](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/27)
Agent manager MVP widget (Level 0 preview). The full Level-1 roster is
[#55](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/55),
inside the M2 agents-manager epic (#54–#61).

---

## 1. Scope

### In scope for this change

- A **separate internal app module**, laid out like `internal-apps/window-manager/`.
- A **read-only roster**: agent id, label, status, activity, and elapsed time.
- Status words and spinner from `AgentStatus`; per-agent tasks from
  `ActivityTimeline`.
- A `RosterSource` seam with a bundled fixture roster and a live event reducer.
- A registry entry (`agents`) so Spotlight, the gallery, the dock, and the agent
  parser pick it up.
- Tests for the reducer, formatting, source subscription, and widget states.

### Explicitly out of scope

- **Chat.** The orb owns conversation; the roster is not a second chat surface.
- **Control verbs** (pause / resume / cancel / retry) — Level 2, #57.
- **Permission approvals** — #58 and #61; `InterruptPanel` is the right home.
- **Engine settings** — Settings owns configuration.
- **Scheduled duties and artifacts** — #59 and #60.
- **A new engine endpoint or wire contract.** The widget consumes the existing
  `ServerEvent` union.

---

## 2. Why a roster

The shell already has an interface to the agent (the orb) and a wire contract for
its states and tasks. What it lacks is a surface that answers:

> what are my agents doing right now, and is anything stuck?

The roster answers that in one line per duty. It deliberately reuses the wire
states instead of inventing a parallel vocabulary, so the OS speaks with one
voice.

---

## 3. Module layout

```text
src/internal-apps/agents-manager/
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.tsx                 # shell entry + injectable inner widget
│       ├── App.test.tsx
│       ├── roster.ts               # AgentRow, fixture source, live reducer
│       ├── roster.test.ts
│       └── agents-manager.css      # token-only content styles
└── README.md
```

The module is self-contained: it imports the UI library and the shared wire
types, never the window manager or the shell's agent store.

---

## 4. Data contract

```ts
export interface AgentRow {
  id: string
  label: string
  status: AgentStateName
  activity: string
  since: number | null
  tasks: TimelineTask[]
}
```

- `status` is the existing wire vocabulary (`types/agentEvents.ts`), not a new
  enum.
- `since` is the start of the current status; `null` for idle or scheduled work.
- `activity` is one honest line: what the agent is doing, waiting on, or why it
  failed. It is never invented work.
- `tasks` feeds `ActivityTimeline` in the detail pane.

---

## 5. Sources

`RosterSource` has three jobs:

```ts
interface RosterSource {
  kind: 'fixture' | 'live'
  rows(): readonly AgentRow[]
  subscribe(listener: () => void): () => void
  apply(event: ServerEvent): void
}
```

### Fixture source

`fixtureRoster()` carries the four duties from `concepts.md` §2: research-web,
file-indexer, nightly-sync, and morning-brief. The widget shows a `fixture` badge
so the data is never mistaken for live state.

### Live source

`liveRoster()` starts with the one agent the wire contract can identify today:
`agent.nexus` (the UI agent). `apply()` folds `ServerEvent`s into that row. It
does **not** invent rows for unknown agents — per-agent identity is #54.

### Why fixture is the default today

The engine client is not wired into the shell yet (#41) and there is no shared
desktop event bus (#45). When those land, the shell creates
`liveRosterSource()` and forwards `ServerEvent`s; the widget needs no changes.

---

## 6. Event mapping

| Event | Roster effect |
| --- | --- |
| `agent.state` | Sets the UI agent's status, activity line, and `since`; `idle` clears `since`. |
| `task.progress` | Adds or updates a task in the UI agent's timeline and reflects the task word in the activity line. |
| `run.interrupt` | Sets `waiting` and shows the interrupt message. |
| `run.completed` | `ok` returns to idle; `failed` / `cancelled` become an error. |
| `run.error` | Sets `error` and shows the engine's message. |
| other events | Ignored; the reducer returns the same row array. |

`applyServerEvent()` is pure and returns the same array when nothing changes, so
`useSyncExternalStore` does not re-render on no-ops.

---

## 7. UI

| Size | Layout |
| --- | --- |
| `2x1` | Compact roster, scrolls; no detail pane. |
| `2x2` | Roster + detail side by side. |
| `4x2` | Wider split; the detail pane gets more room. |
| fullscreen | Same split as `4x2`. |

Header: agent count, aggregate summary (`1 working · 1 waiting · 1 error`), and
the `fixture` / `live` source badge.

Row: status (`AgentStatus`), label, elapsed time, activity, and the agent id.

Detail: id, status, activity, elapsed time, `ActivityTimeline`, and a quiet
"read-only preview" note. The note is deliberate: no verb appears until the
engine can perform it.

Empty roster: `EmptyState` with "no agents on the roster".

---

## 8. Reuse and design rules

- Reuses `AgentStatus`, `ActivityTimeline`, `Badge`, `EmptyState`, `Label`, and
  `Mono` from `@/ui`.
- Tokens only; no raw hex. Teal marks working/waiting; errors stay ink.
- ASCII glyphs only.
- No text input, no chat, no settings.
- The shell draws the frame; the module renders content only.

---

## 9. Tests

`roster.test.ts`:

- fixture rows carry id / label / status / activity and tasks
- counts and the aggregate summary
- elapsed formatting (seconds, minutes, hours, idle)
- `agent.state`, `task.progress`, `run.interrupt`, `run.completed`, `run.error`
- no-op events return the same reference
- source subscription, unsubscribe, and fixture `apply` no-op
- unknown agent ids never create rows

`App.test.tsx`:

- every fixture row and the source badge render
- selection moves the detail pane and its timeline
- `2x1` hides the detail; `2x2` shows it
- a live source updates from `ServerEvent`s
- an empty roster shows the empty state
- no textbox or chat affordance exists

---

## 10. Acceptance checklist (#27)

- [x] Minimal roster slice per `concepts.md`: id, label, status, activity.
- [x] Live status via agent events: reducer + live source are ready.
- [ ] Live feed wired into the shell — blocked by #41 / #45; fixture mode is the
      honest default until then.
- [x] Reuses `AgentStatus` / `ActivityTimeline`.
- [x] Registered in `apps/registry.ts` and tested.
- [x] Not a chat surface, engine settings page, or permission pop-up factory.

---

## 11. Roadmap

| Level | Issue | Scope |
| --- | --- | --- |
| 0 | #27 | Read-only fixture roster; live reducer seam. **This change.** |
| 1 | #54, #55 | Engine agent identity contract + live roster rows. |
| 1 | #56 | Orb dressing from the roster aggregate (working / error). |
| 2 | #57 | Pause / resume / cancel / retry, only when the engine can perform them. |
| 2 | #58 | Waiting agents route into `InterruptPanel`. |
| 3 | #59 | Scheduled duties. |
| 3 | #60 | Agent artifacts linked into the Files viewer. |
| 3 | #61 | Per-agent permissions in the execution gateway. |

---

## 12. Risks and open questions

These are the same questions `concepts.md` §6 raises with the Agent team:

1. Are agent identities stable enough for a roster (`id`, `label`, `status`,
   `since`)? If not, what is the minimal shape?
2. Are pause / resume / cancel honest today? The UI must never show a verb the
   engine cannot perform.
3. Are scheduled duties engine-side or shell-side timers?
4. Who approves permissions, and where does that surface?
5. Do agents own files the Files viewer should open?
