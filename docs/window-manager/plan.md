# Window Manager Plan (Phase 1 / MVP)

## Goal

Ship a working **internal** window manager inside the Nexus React/Tauri shell so app widgets can be opened, focused, moved, resized, snapped, minimized, fullscreened, and restored after restart.

**End output of the whole WM track:** a demo where 2+ widgets are on screen, layout controls work, session survives relaunch, and `get_desktop_state` returns data that matches the UI.

**Not in this track:** native Win32 window control, agent/voice/gestures, building full app UIs (Notes/Files/etc. content).

---

## Owners (exactly 2 people)

| Person | Track | Responsibility in one line |
|--------|--------|----------------------------|
| **Yash** | WM-A | Own the **data + memory**: what windows exist, who is focused, save/load, IPC read/persist |
| **Divy** | WM-B | Own the **interaction + UI chrome**: drag/resize/modes, snap, canvas, taskbar — all calling Yash’s store |

Raghav is optional backup only if blocked — no assigned tasks.

**Hard rule:** there is one window list (Yash’s store). Divy must not keep a separate `useState` array of windows.

---

## Shared contract (both agree before coding deep)

### Types (source of truth)

File: `modules/window-state/types.ts`  
Shell must re-export from `apps/shell/frontend/src/types/WindowState.ts` (no divergent copy).

```typescript
type WindowMode = 'minimized' | 'windowed' | 'fullscreen'

interface WindowState {
  id: string
  appId: string
  title: string
  mode: WindowMode
  x: number
  y: number
  width: number
  height: number
  workspaceId: string
  monitor: number
  focused: boolean
  zIndex: number
  isExternal: boolean          // always false in Phase 1
  externalHandle?: string
  gridCol?: number             // optional; for grid snap
  gridRow?: number
  gridW?: number
  gridH?: number
}

interface DesktopSession {
  windows: WindowState[]
  focusedId: string | null
  activeWorkspaceId: string
  grid?: { cols: number; rows: number }
}
```

### Store API Divy will call (Yash implements)

| Action | Input | Effect |
|--------|--------|--------|
| `openApp(appId, opts?)` | app id (+ optional title/size) | Adds a `WindowState`, focuses it |
| `closeApp(id)` | window id | Removes from session |
| `focusApp(id)` | window id | That window `focused: true`, others false; highest `zIndex` |
| `moveWindow(id, x, y)` | id + position | Updates geometry |
| `resizeWindow(id, w, h)` | id + size | Updates geometry |
| `setMode(id, mode)` | id + mode | minimized / windowed / fullscreen |
| `arrange(preset)` | `'cascade' \| 'tile' \| 'snap-all-to-grid'` | Batch-updates positions |
| `switchWorkspace(id)` | workspace id | Changes `activeWorkspaceId` |
| `hydrate(session)` | full `DesktopSession` | Replaces in-memory state (boot) |
| `getSnapshot()` | — | Returns serializable `DesktopSession` |

### IPC tools (names stay stable for the AI team later)

File: `modules/ipc/contract.ts`

| Command | Input | Output |
|---------|--------|--------|
| `get_desktop_state` | optional `{ monitor? }` | `{ windows, focusedId, activeWorkspaceId }` matching live UI |
| `open_app` | `{ app_name }` | success + new window id |
| `close_app` | `{ window_id }` | success |
| `focus_window` | `{ window_id }` | success |
| `move_window` | `{ window_id, x, y }` | success |
| `resize_window` | `{ window_id, width, height }` | success |
| `set_window_mode` | `{ window_id, mode }` | success |
| `switch_workspace` | `{ workspace_id }` | success |
| `persist_workspace` | `{ name?, layout? }` or force-flush current | success |

---

## MVP checkpoints → what “done” means

| Checkpoint | Owner | Needed | Output |
|------------|--------|--------|--------|
| Define & store layout/state of each active app | Yash | Shared types + store | Every open app is a row in `DesktopSession.windows` |
| Save opened + focused app | Yash | Debounced persist | Disk/cache file contains windows + `focusedId` |
| Restore on launch | Yash | Boot hydrate | Relaunch shows same apps, sizes, focus |
| Move / resize / arrange / minimize / fullscreen | Divy | Store actions from Yash | User can do all of these with mouse on widgets |
| Grid snap | Divy | Grid size agreed with OS Layout | Widgets snap to cells on drag/resize end |
| Sign-off | Both | Demo script below | Checklist all green |

---

# Yash — WM-A tasks

## Task A1 — Types + desktop store

### Needed
- Existing stubs: `modules/window-state/types.ts`, `useDesktopState.ts`, `App.tsx`
- Agreement on `DesktopSession` + store actions (table above)

### Do
1. Finalize `WindowState` / `DesktopSession` / `WindowMode` in `modules/window-state/types.ts`
2. Make shell types re-export that module (delete divergent fields except any shell-only extras kept separate)
3. Implement `useDesktopState` as React context + reducer with all store actions
4. Rules that must hold after every action:
   - At most one window has `focused: true`
   - Focused window has the highest `zIndex`
   - `focusedId` matches the focused window’s `id` (or `null` if none)
   - Minimized windows remain in `windows[]`
5. Wrap shell in the provider from `App.tsx`

### Output
- [ ] Working `DesktopSessionProvider` + `useDesktopState()` hook
- [ ] Unit-level proof: call `openApp` twice → `windows.length === 2`; `focusApp` → only one focused
- [ ] Divy can import the hook and call actions without touching window arrays directly
- [ ] Short note in this folder or PR description: list of exported actions

**Acceptance:** From a throwaway button or console, open/close/focus works and state stays consistent.

---

## Task A2 — Persist + restore

### Needed
- A1 store + `getSnapshot()` / `hydrate()`
- `modules/storage/schema.sql` (`workspaces.layout` JSON preferred)
- Fallback allowed: `localStorage` key e.g. `nexus.desktopSession` if SQLite/Tauri not ready in first PR

### Do
1. On any geometry/mode/focus/open/close change: debounce ~300–500ms, write full `DesktopSession` JSON
2. Also flush on window unload / app close if possible
3. On shell boot (before or immediately as canvas mounts): read last session → `hydrate()`
4. If no saved session: start empty or single welcome window (pick one; document it)

### Output
- [ ] Persist path implemented (SQLite `workspaces.layout` and/or localStorage)
- [ ] Documented restore path (where file/key lives, when hydrate runs)
- [ ] Manual test: open 2 apps, focus one, kill shell, relaunch → same 2 apps + same focused id + same x/y/w/h (within snap rounding)

**Acceptance:** Restart test passes without Divy’s snap work (pixel geometry restore is enough).

---

## Task A3 — IPC read + persist surface

### Needed
- A1 live store
- A2 persist flush function
- `modules/ipc/contract.ts`, `useIPC.ts`, `src-tauri/src/commands/window.rs`

### Do
1. Add typed args for WM commands (at least `get_desktop_state`, `persist_workspace`, `focus_window`)
2. `get_desktop_state` returns current snapshot (from store when invoked from shell; Rust may proxy or return last saved — **preferred:** shell answers from live store in Phase 1)
3. `persist_workspace` forces an immediate save
4. Fix Rust compile issues on `ipc_dispatch` if they block `cargo run` (persist/load only; no Win32 mutate required)

### Output
- [ ] Calling `get_desktop_state` returns JSON that matches open windows on screen
- [ ] Calling `persist_workspace` writes current session immediately
- [ ] Contract file lists commands + arg shapes so Agent team can copy later
- [ ] Brief “how to call from shell” note (via `useIPC` or store)

**Acceptance:** With 2 windows open, `get_desktop_state` lists both with correct `focused` / geometry.

---

# Divy — WM-B tasks

## Task B1 — Interactive WindowFrame

### Needed
- Yash A1 stub at minimum (`moveWindow`, `resizeWindow`, `setMode`, `focusApp`, `closeApp`)
- Current `WindowFrame.tsx` (presentational only today)

### Do
1. Titlebar pointer drag → continuous `moveWindow` (or local preview + commit; either OK if store stays source of truth)
2. Corner/edge resize handles → `resizeWindow`
3. Chrome buttons: minimize → `setMode(id, 'minimized')`; fullscreen toggle ↔ `windowed`/`fullscreen`; close → `closeApp`
4. Pointer down on frame → `focusApp`
5. Content area: render placeholder by `appId` (real widgets come from OS Layout later)

### Output
- [ ] Updated `WindowFrame.tsx` that **calls** the store callbacks/actions (today’s props `onMove`/`onResize` must actually fire)
- [ ] CSS for titlebar, resize handles, control buttons
- [ ] Demo GIF or short checklist: drag, resize, minimize, fullscreen, close, focus z-order

**Acceptance:** One window can be fully manipulated with mouse; focus brings it above others.

---

## Task B2 — Snap + arrange

### Needed
- B1 working drag/resize
- Grid size agreed with OS Layout (recommend default **12 cols × 8 rows** if not specified)
- Yash `arrange(preset)` + optional grid fields on `WindowState`

### Do
1. On drag/resize **end**: snap position/size to grid cells and/or screen edges (left/right half, maximize)
2. Show a light preview overlay while snapping
3. Wire arrange presets: `cascade`, `tile`, `snap-all-to-grid` (taskbar button or temp debug controls OK)
4. Clamp windows so they cannot leave the canvas entirely

### Output
- [ ] Snap helper module (e.g. `snap.ts` or under `components/`) with pure functions + tests or clear examples
- [ ] Visual preview during drag near snap targets
- [ ] Documented grid: `{ cols, rows }` and how pixel rect maps to `gridCol/Row/W/H`

**Acceptance:** Release near left edge → half-screen (or grid-equivalent); `arrange('tile')` lays out all open windowed apps without overlap chaos.

---

## Task B3 — WorkspaceCanvas + Taskbar

### Needed
- Store with `windows`, `activeWorkspaceId`, minimized handling
- B1 frames

### Do
1. `WorkspaceCanvas`: render only windows where `workspaceId === activeWorkspaceId` and `mode !== 'minimized'`
2. `Taskbar`: show running apps; click focused/restores minimized (`setMode` → `windowed` + `focusApp`); optional workspace switch control
3. Entry point to `openApp` for at least Notes / Files / Settings (buttons or launcher stub; coordinate with OS Layout gallery)

### Output
- [ ] `App.tsx` uses `WorkspaceCanvas` + `Taskbar` (not only inline placeholders)
- [ ] Minimized app disappears from canvas but remains on taskbar and in session
- [ ] Opening a second app from UI adds a second frame via store

**Acceptance:** Full mini-desktop loop without DevTools: open → use → minimize → restore → close.

---

# Integration (both)

## Order

| Step | Yash delivers | Divy delivers | Shared output |
|------|---------------|---------------|---------------|
| 1 | Types + store stub (persist no-op OK) | WindowFrame drag against store | One window moves via store |
| 2 | Focus / open / close solid | Resize + modes + canvas | Multi-window focus works |
| 3 | Persist / restore | Snap + arrange | Restart keeps layout |
| 4 | IPC `get_desktop_state` + persist | Taskbar + open apps UI | End-to-end desktop usable |
| 5 | Joint demo + sign-off | Joint demo + sign-off | Checklist below green |

## Joint sign-off checklist (final output)

Run this and tick:

- [ ] Open ≥2 apps (e.g. Notes + Files) from UI
- [ ] Drag and resize both; snap/grid behaves predictably
- [ ] Arrange tile/cascade works
- [ ] Minimize one → gone from canvas, still in taskbar/session
- [ ] Fullscreen one → fills canvas; restore back to prior size
- [ ] Clicking windows updates focus/z-order correctly
- [ ] Kill app → relaunch → same windows, geometries, focused app
- [ ] `get_desktop_state` matches what is on screen

**Final artifact:** this demo is the WM MVP deliverable for review.

---

## Out of scope (do not build)

| Item | Why |
|------|-----|
| Win32 `EnumWindows` / `SetWindowPos` / hooks | Phase 5 / Rust OS team |
| Real Notes/Files app features | OS Layout / app owners |
| Agent tool loop, voice, gestures, avatar | Other MVP tracks |
| macOS / Linux native WM | Post-v1 |

---

## Key files by owner

| File | Owner |
|------|--------|
| `modules/window-state/types.ts` | Yash |
| `modules/ipc/contract.ts` | Yash |
| `modules/storage/schema.sql` (+ persist helpers) | Yash |
| `apps/shell/frontend/src/hooks/useDesktopState.ts` | Yash |
| `apps/shell/frontend/src/hooks/useIPC.ts` | Yash (wire) |
| `src-tauri/src/commands/window.rs` (persist/load) | Yash |
| `apps/shell/frontend/src/components/WindowFrame.tsx` | Divy |
| `apps/shell/frontend/src/components/WorkspaceCanvas.tsx` | Divy |
| `apps/shell/frontend/src/components/Taskbar.tsx` | Divy |
| Snap helper module | Divy |
| `apps/shell/frontend/src/App.tsx` | Both (Yash provider; Divy chrome) |
