# Notes Internal App

## Purpose
Built-in notes widget mountable on the NEXUS desktop canvas.

## Tech Stack
- React 19 + TypeScript + Vite

## Folder Layout
```
internal-apps/notes/
├── frontend/
│   ├── package.json
│   └── src/
│       └── App.tsx          # Notes widget UI
└── backend/
    └── README.md
```

## How to Run
This widget is consumed by `apps/shell/frontend`. No standalone dev server required.

## How to Add a Feature
1. Add UI state in `frontend/src/App.tsx`.
2. Expose a backend endpoint in `backend/` if persistence is needed.
3. Register the widget in the shell's app registry.

## IPC / API Contracts
None by default. Extend `modules/ipc` if the widget needs shell-level commands.

## Testing
No tests configured yet. Add Vitest under `frontend/`.
