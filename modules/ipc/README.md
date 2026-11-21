# IPC Module (Cross-Cutting)

## Purpose
Typed JSON-RPC contract between the React shell, Rust Tauri layer, and Python engine. Single source of truth for command names and payload shapes.

## Tech Stack
- TypeScript interfaces + Rust serde structs

## Folder Layout
```
modules/ipc/
├── contract.ts        # TS command + request/response types (source of truth)
└── README.md
```

## How to Use
Import from `@nexus/ipc` in the shell (aliased to this file). The shell also re-exports via `@/types/ipc`.

```typescript
import type { IPCRequest, IPCResponse } from '@nexus/ipc'
import { WM_IPC_COMMANDS } from '@nexus/ipc'
```

## Window-manager commands

Command names and arg shapes for desktop control live in `contract.ts`
(`get_desktop_state`, `open_app`, `close_app`, `focus_window`, `move_window`,
`resize_window`, `set_window_mode`, `switch_workspace`, `persist_workspace`).

**Live shell status:** the production UI is the 6×4 grid store
(`apps/shell/frontend/src/wm/desktopStore.tsx`). The free-placement
`desktopIPC.ts` / `useDesktopIPCBridge.ts` handlers were removed with issue #33.

Layout persistence uses the engine REST form of `persist_workspace`:
`PUT /api/v1/workspaces/{id}` / `GET` via `wm/workspacePersistence.ts`
(SQLite `workspaces.layout`, with `nexus-desktop-v1` localStorage as cache).
See `modules/window-state/README.md`.

Rust `ipc_dispatch` can still queue WM mutations and cache a snapshot, but the
shell no longer mounts a free-placement bridge that pushes `DesktopSession` or
applies those events. Grid-backed Tauri IPC wiring remains a follow-up if needed.

Non-WM commands `search_web` / `fetch_article` remain in `IPCCommand` for the
search track.

### Error shape
Always `{ success: false, error: string }` — never thrown.

## How to Add a Feature
1. Add a variant to `IPCCommand` and `IPCArgsMap` in `contract.ts`.
2. If it is a WM command, add it to `WM_IPC_COMMANDS` and implement the
   corresponding handler in the **grid** store / future shell bridge (not a
   resurrected free-placement store).
3. Add a match arm in Rust `src-tauri/src/commands/window.rs`.
4. Add a handler in the Python engine when the agent should call it.
