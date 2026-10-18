# IPC Module (Cross-Cutting)

## Purpose
Typed JSON-RPC contract between the React shell, Rust Tauri layer, and Python engine. Single source of truth for command names and payload shapes.

## Tech Stack
- TypeScript interfaces + Rust serde structs

## Folder Layout
```
modules/ipc/
├── contract.ts        # TS command + request/response types
└── README.md
```

## How to Use
Import `IPCCommand`, `IPCRequest`, `IPCResponse` in the shell frontend. Mirror the enum in Rust `src/commands/window.rs`.

## How to Add a Feature
1. Add a variant to `IPCCommand` in `contract.ts`.
2. Add a match arm in the Rust command handler.
3. Add a handler in the Python engine endpoint.

## IPC / API Contracts
See `contract.ts`.
