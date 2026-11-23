# Memory widget

Status: **Planned** for #97 (read-only browser and health) and #99 (controls).
Follow [the internal app guide](../ui-library/app-guide.md): content only, the shell
draws the frame, `@/ui` and theme tokens only, and no invented live state.

The widget is not a chat surface. The orb owns conversation. The Memory widget
answers three questions:

1. What does the agent remember about me?
2. Where did that memory come from, and is it still valid?
3. What is pending review or broken, and what can I do about it?

---

## 1. Registry entry

Add to `apps/shell/frontend/src/apps/registry.ts`:

```ts
memory: {
  label: 'memory',
  glyph: '[m]',
  sizes: ['1x1', '2x1', '2x2', '4x2'],
  defaultSize: '2x2',
  aliases: ['memory', 'memories', 'remember', 'knowledge', 'brain', 'profile'],
  fullscreen: true,
  phase: 'later',
  component: MemoryApp,
}
```

Required registry fix: remove `memory` from the `monitor` aliases. Keep `ram` and
`usage`. Add a test that:

- every alias resolves to exactly one app;
- `memory` resolves to the Memory app;
- `monitor` still resolves `ram` and `usage` to the system monitor.

## 2. Folder layout

```text
apps/shell/frontend/src/internal-apps/memory/
  frontend/
    src/
      App.tsx
      App.test.tsx
      source.ts          # MemorySource + MemoryActions
      source.test.ts
      MemoryApp.css
      views/
        BrowseView.tsx
        ReviewView.tsx
        IdentityView.tsx
        HealthView.tsx
  backend/
    README.md            # explains that the engine owns the data and API
  README.md
```

`backend/` is documentation only unless app-local logic is genuinely needed. The
widget never reads SQLite and never owns a second cache of canonical memory.

## 3. Source seam

```ts
export type MemorySourceKind = 'fixture' | 'live'

export interface MemorySource {
  readonly kind: MemorySourceKind
  stats(): Promise<MemoryStats>
  search(query: MemoryQuery): Promise<MemoryPage<MemoryHit>>
  get(memoryId: string): Promise<MemoryDetail>
  proposals(status?: ProposalStatus): Promise<MemoryPage<MemoryProposalView>>
  identity(): Promise<IdentityProfile>
  health(): Promise<MemoryHealth>
  subscribe(listener: () => void): () => void
  apply(event: ServerEvent): void
}
```

Mutation methods live in a separate interface and are only exposed by the live
source after #98:

```ts
export interface MemoryActions {
  edit(memoryId: string, patch: MemoryEdit): Promise<MemoryDetail>
  pin(memoryId: string, pinned: boolean): Promise<void>
  forget(memoryId: string, mode: 'delete' | 'invalidate', reason: string): Promise<void>
  approve(proposalId: string): Promise<void>
  reject(proposalId: string, reason: string): Promise<void>
  patchIdentity(fields: IdentityFieldPatch[]): Promise<IdentityProfile>
  rebuildIndex(mode: 'fts' | 'vector' | 'all'): Promise<void>
}
```

Rules:

- `fixture` is the honest default until #41 and #45 land. The widget shows a
  `fixture` badge and never presents fixture rows as live memory.
- `live` uses `engineClient` for reads and the shared event bus for updates.
- `apply()` upserts by memory ID; events never create rows the API cannot return.
- A failed refresh keeps the last known data visible with a `last updated` label.
- The source is read-only from the widget's point of view. Writes go through
  `MemoryActions` and the audited API.
- No direct `fetch`, no SQLite, no filesystem access.

## 4. Layouts

| Size | Content |
| --- | --- |
| `1x1` | Total memories, pending review count, index health dot. Clicking opens the fullscreen browser. |
| `2x1` | Recent and pinned memories, pending-review badge, one-line health. |
| `2x2` | Search input, filter chips, result list, detail pane. |
| `4x2` | Tabs: Browse / Review / Identity / Health. Scope and tier filters, list, detail, audit timeline. |
| fullscreen | Same tabs with a wider list, editor, evidence panel, and health checks. |

The layout must remain readable at 1x1 without truncating a number into a lie. If
the count is still loading, show a skeleton, not `0`.

## 5. Views

### Browse

- Search box with quoted phrases and `tier:` / `scope:` filter chips.
- Result rows show title or excerpt, tier, kind, confidence, importance, validity,
  and a sensitive marker.
- Empty state explains that memory is built from conversations and reviewed
  proposals; it does not invent example rows.
- Filter state is local to the widget and not persisted as canonical memory.

### Detail

Show:

- full content, title, tier, kind, scope, status, revision;
- confidence, importance, sensitivity, validity;
- provenance and source refs;
- originating run and request;
- revision history and audit tail;
- pin/edit/forget controls only when #99 and the API support them.

### Review

- Pending proposals with operation (`ADD`, `UPDATE`, `SUPERSEDE`, `MERGE`,
  `NOOP`), tier, confidence, origin, and review reason.
- Evidence excerpts and a before/after diff for update and supersede.
- Approve/reject in #99. #97 is read-only and says so.
- Keyboard: `j`/`k` to move, `Enter` to open, `a`/`r` only when actions exist.

### Identity

- Explicit fields are editable after #99.
- Inferred fields show evidence and confidence and are visually distinct.
- Sensitive fields are gated behind an explicit reveal.
- There is no free-form persona editor; persona stays versioned configuration.

### Health

- Index mode (`fts5`, `like`, or `hybrid`) and indexed versus canonical counts.
- Pending proposals, stale projections, repair queue, expired items, sensitive
  items, and last rebuild time.
- A rebuild button in #99 with progress and a result summary.
- Degraded mode explains what still works: reads use canonical rows and the
  fallback path.

## 6. Event mapping

| Event | Widget effect |
| --- | --- |
| `memory.context_ready` | Update the "last context" line: item count, tokens, index mode. |
| `memory.link` | Update the Liaison activity line. |
| `memory.proposal` | Refresh the pending badge and the Review tab. |
| `memory.updated` | Upsert the row, refresh detail if open, update counts. |
| `memory.health` | Refresh the health dot and Health tab. |
| `memory.repair` | Update the repair queue and show progress. |
| connection lost | Keep last data, show a connection banner, pause auto-refresh. |

Events are hints to refresh; the API remains the source of truth.

## 7. Honest states

| State | Behavior |
| --- | --- |
| Fixture | Badge `fixture`; reads work; actions hidden; tooltip explains the engine client is not wired. |
| Loading | Skeletons with stable dimensions; no fake counts. |
| Empty | Explain how memory is created; no sample rows unless they are clearly marked as examples. |
| Error | Show the typed error and a retry; keep old data if available. |
| Degraded | Show index mode and repair status; reads remain available. |
| Connection lost | Keep last data, show the banner, stop pretending events are live. |

## 8. Style and accessibility

- ASCII only in UI strings and glyphs.
- Theme tokens only; no hard-coded colors.
- Reuse `@/ui` primitives; do not fork shell components.
- Every control has a visible label or an accessible name.
- Focus is visible; the tab order follows the visual order.
- Destructive actions require a confirmation that states exactly what changes.
- The widget never writes memory on mount, on search, or on tab change.

## 9. Tests

- Registry: app is registered, sizes and aliases are valid, aliases are unique,
  `memory` resolves to Memory, `monitor` still resolves `ram` and `usage`.
- Source: fixture reads, live reads, event upsert, refresh failure, connection loss.
- Sizes: each layout renders at `1x1`, `2x1`, `2x2`, `4x2`, and fullscreen.
- Browse: search, filter, empty, error, detail selection.
- Review: read-only in #97; approve/reject/error paths in #99.
- Identity: explicit versus inferred rendering, sensitive gate, edit path in #99.
- Health: degraded mode, repair queue, rebuild progress.
- Accessibility: keyboard navigation and labels for every action.
- No fake live state: fixture badge is present whenever the source is `fixture`.

## 10. Out of scope

- Chat or a second conversation surface.
- Direct SQLite, filesystem, or network access.
- Agent controls (pause/resume/cancel) - those belong to the roster and #57.
- Policy approvals - `InterruptPanel` owns them.
- Persona editing.
- Graph/entity visualization - #79 in M3.
