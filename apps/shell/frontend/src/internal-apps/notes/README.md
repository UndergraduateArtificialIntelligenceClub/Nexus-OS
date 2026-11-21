# Notes Internal App

## Purpose
One plain-text note, mountable on the NEXUS desktop canvas. The note is written
through the shared storage seam in `apps/shell/frontend/src/storage`, so it
survives a relaunch: a file under AppData inside Tauri, localStorage in the
browser fallback.

## Tech Stack
- React 19 + TypeScript + Vite
- `@/storage` (`KeyValueStorage`; Tauri fs, localStorage, memory backends)

## Persistence
- Storage key `notes`; Tauri keeps it at `$APPDATA/storage/notes.txt`.
- Edits save on a 500 ms debounce; a pending save is flushed when the widget
  closes. A failed write is reported honestly (`couldn't save`).
- On first run the old `nexus-notes` localStorage key is adopted, written to the
  new store, and removed.
- The footer shows the save state plus word and character counts.

## Folder Layout
```
internal-apps/notes/
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.tsx          # Notes widget UI + persistence
│       ├── App.test.tsx
│       └── notes.css
└── backend/
    └── README.md
```

## How to Run
This widget is consumed by `apps/shell/frontend`. No standalone dev server required.

## How to Add a Feature
1. Add UI state in `frontend/src/App.tsx`.
2. Persist through `@/storage`; don't reach for `localStorage` directly.
3. Register the widget in the shell's app registry.

## IPC / API Contracts
None. Persistence goes through the frontend storage seam rather than a widget
backend.

## Testing
Vitest + React Testing Library, no globals. `App.test.tsx` covers load, debounced
saves, flush on close, migration from `nexus-notes`, save errors, and the footer
counts, using the in-memory backend.
