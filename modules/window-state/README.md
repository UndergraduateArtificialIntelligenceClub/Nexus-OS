# Window-State Module (Cross-Cutting)

## Purpose
Shared `WindowState` abstraction consumed by the React shell (TS), Rust layer, and Python engine. Guarantees a single data contract for internal widgets and external Win32 windows.

## Tech Stack
- TypeScript

## Folder Layout
```
modules/window-state/
├── types.ts             # WindowState + WindowMode
└── README.md
```

## How to Use
Import `WindowState` in `apps/shell/frontend/src/types/WindowState.ts` (re-export from here).

## How to Add a Feature
Add a field to `WindowState` and update all three consumers (TS, Rust struct, Pydantic model).

## IPC / API Contracts
See `types.ts`.
