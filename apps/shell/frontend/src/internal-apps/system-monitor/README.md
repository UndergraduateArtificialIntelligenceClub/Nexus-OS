# System Monitor Internal App

## Purpose
Built-in system resource monitor widget mountable on the NEXUS desktop canvas.

## Tech Stack
- React 19 + TypeScript + Vite

## Folder Layout
```
internal-apps/system-monitor/
├── frontend/
│   ├── package.json
│   └── src/
│       └── App.tsx
└── backend/
    └── README.md
```

## How to Run
Consumed by `apps/shell/frontend`.

## How to Add a Feature
Wire up backend telemetry (CPU/RAM) via Rust `commands`.

## IPC / API Contracts
Expose system metrics via Tauri commands in `src-tauri/src/commands/`.

## Testing
No tests configured yet.
