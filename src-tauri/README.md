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
│   ├── state.rs           # Live cached desktop topology
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

## How to Add a Feature
1. Win32 API call → `src/win32/`
2. Tauri command → `src/commands/`
3. Register command in `src/main.rs` invoke_handler

## IPC / API Contracts
Exposes `ipc_dispatch` Tauri command. Contract defined in `modules/ipc`.

## Testing
Add unit tests under `tests/systems/`.
