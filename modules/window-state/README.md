# Window-State Module (Cross-Cutting)

## Purpose
Shared `WindowState` abstraction consumed by the React shell (TS), Rust layer, and Python engine. Guarantees a single data contract for internal widgets and external Win32 windows.

## Tech Stack
- TypeScript

## Folder Layout
```
modules/window-state/
├── types.ts             # WindowState + WindowMode + DesktopSession
└── README.md
```

## How to Use
Import `WindowState` in `apps/shell/frontend/src/types/WindowState.ts` (re-export from here).

## How to Add a Feature
Add a field to `WindowState` and update all three consumers (TS, Rust struct, Pydantic model).

## IPC / API Contracts
See `types.ts`.

## Session persistence (Phase 1 / Task A2)

The shell owns save/restore of a full `DesktopSession`. Implementation lives in
`apps/shell/frontend/src/wm/sessionPersistence.ts` and is wired by
`DesktopProvider`.

| Detail | Value |
|--------|--------|
| Storage | `localStorage` (SQLite `workspaces.layout` deferred) |
| Key | `nexus.desktopSession` |
| Schema version | `1` (versioned JSON envelope with `savedAt` + `session`) |
| Debounce | 400ms (`DEFAULT_SAVE_DEBOUNCE_MS`) |
| Boot | `loadSession()` → `createDesktopStore({ initialSession })` |
| Immediate flush | `pagehide`, `visibilitychange` (hidden), persister `dispose()`, and `useDesktopStoreHandle().flush()` (for A3 `persist_workspace`) |

Corrupt or unknown-version data is ignored and the seed session is used.
Malformed individual windows are dropped; focus/z-order invariants are repaired by the store on hydrate.

## Grid shell persistence (issue #28)

The live grid shell (`wm/desktopStore.tsx`) persists through
`wm/workspacePersistence.ts`, with SQLite as the store of record.

| Detail | Value |
|--------|--------|
| Store of record | SQLite `workspaces.layout`, row `default`, via engine `PUT /api/v1/workspaces/{id}` (`persist_workspace`) |
| Launch load | `GET /api/v1/workspaces/{id}` (1.5s timeout) |
| Cache / fallback | `localStorage` key `nexus-desktop-v1`, written on every change |
| Envelope | `{ version: 1, savedAt, session: { instances, focusedId } }`, same in both places; the pre-envelope bare `{ instances, focusedId }` cache is still read |
| Debounce | 400ms (`REMOTE_SAVE_DEBOUNCE_MS`) for the SQLite write; the cache write is immediate |
| Boot | `loadDesktop()` paints the cache, then `createWorkspaceSync().start()` restores the SQLite copy if its `savedAt` is newer and the user hasn't touched the desk yet; otherwise the local layout is pushed |
| Immediate flush | `pagehide`, `visibilitychange` (hidden, `keepalive` fetch), provider unmount |
| No engine | Every remote failure is swallowed; the cache keeps saving and restoring |
