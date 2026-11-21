# Rust Tauri Core (Native Systems Core)

## Purpose
Low-latency systems integration layer. Handles Win32 window enumeration/hooks, geometry control, and FastAPI sidecar lifecycle management. Exposes Tauri commands to the React shell.

## Tech Stack
- Rust, windows-rs (Win32 User32 / Shell32 APIs), Tauri v2, serde

## Folder Layout
```
src-tauri/
├── Cargo.toml
├── tauri.conf.json
├── src/
│   ├── main.rs            # Tauri app entry point
│   ├── sidecar.rs         # FastAPI process lifecycle
│   ├── state.rs           # Live cached desktop topology + DesktopStateCache
│   ├── win32/             # Win32 API hooks & calls (mod.rs, window.rs)
│   └── commands/          # Tauri commands exposed to frontend (mod.rs, window.rs)
└── README.md
```

## How to Run
```powershell
cd src-tauri
cargo run
```

Requires the Tauri CLI and the React dev server running on port 5173.

## IPC commands (WM)

| Command | Direction | Behaviour |
|---------|-----------|-----------|
| `sync_desktop_state` | Shell → Rust | Stores the latest desktop snapshot JSON in `DesktopStateCache` |
| `ipc_dispatch` | Agent/Shell → Rust | `get_desktop_state` reads the cache (or `shell not ready`). WM mutations + `persist_workspace` emit `nexus://ipc-request` and return `{ queued, request_id }` |
| `ipc_respond` | Shell → Rust | Acknowledges a completed request (logs in Phase 1) |

Contract source of truth: `modules/ipc/contract.ts`.

**Note:** The free-placement shell IPC bridge was removed with issue #33. The
live React WM is the grid store in `apps/shell/frontend/src/wm/desktopStore.tsx`.
Issue #28 shipped grid layout persistence through the engine REST path
(`PUT/GET /api/v1/workspaces/{id}` → SQLite `workspaces.layout`), not through
Tauri `sync_desktop_state`. That Tauri cache/event bridge is still unwired from
the grid store and remains a separate optional follow-up.

### Build note (unverified)
These command handlers were updated as source only. The authoring environment did not have `cargo` installed, so `cargo check` / `cargo run` were not verified. The crate may still need Tauri v2 Cargo feature / `build.rs` / `tauri.conf.json` fixes before it builds.

## How to Add a Feature
1. Win32 API call → `src/win32/`
2. Tauri command → `src/commands/`
3. Register command in `src/main.rs` invoke_handler

## Testing
Add unit tests under `tests/systems/`. Frontend coverage for the live grid WM is
in `apps/shell/frontend/src/wm/layout.test.ts` and `desktopStore.test.ts`.
