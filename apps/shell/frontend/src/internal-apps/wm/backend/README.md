# Window Manager Backend

The widget is a thin view over the frontend window-manager store
(`src/wm/desktopStore.tsx`). Layout persistence is already wired through
`src/wm/workspacePersistence.ts`: every change writes the
`nexus-desktop-v1` localStorage cache immediately and, when the engine is up,
debounces a `persist_workspace` write to SQLite `workspaces.layout` via
`PUT /api/v1/workspaces/{id}` (restored on launch with `GET`).

This widget needs no persistence changes — it already speaks only in store
commands and replies.
