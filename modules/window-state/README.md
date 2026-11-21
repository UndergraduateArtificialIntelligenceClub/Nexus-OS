# Window-State Module (Cross-Cutting)

## Purpose
Shared `WindowState` abstraction for the Rust layer and Python engine (and for
future Phase-5 native Win32 windows). Guarantees a single data contract for
external / native window topology.

The React shell no longer renders free-floating windows. Live shell layout uses
the 6×4 grid store in `apps/shell/frontend/src/wm/desktopStore.tsx`. This module
is **not** imported by the shell UI.

## Tech Stack
- TypeScript

## Folder Layout
```
modules/window-state/
├── types.ts             # WindowState + WindowMode + DesktopSession
└── README.md
```

## How to Use
- Engine / IPC: import from `modules/window-state/types.ts` (see
  `modules/ipc/contract.ts` for `WindowMode`).
- Shell UI: use `@/wm/desktopStore` and `@/wm/layout` instead.

## How to Add a Feature
Add a field to `WindowState` and update Rust serde structs and Python Pydantic
models that consume it. Do not reintroduce free-placement rendering in the shell.

## IPC / API Contracts
See `types.ts` and `modules/ipc/contract.ts`.

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
