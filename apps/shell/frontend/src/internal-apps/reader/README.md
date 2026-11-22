# Reader Internal App

## Purpose
The reader widget: shows the last `article` payload sent to it (`ArticleReader`
from `@/ui`). Headings, paragraphs and lists are set on a ~65ch measure, using the
Bubble scale at widget sizes and the Text scale once there's room. Every evidence
ref is shown as a source badge.

It keeps your place. Resizing, going fullscreen or coming back from the dock
reflows the text, and moving the widget's div resets the browser's scroll. The
reader remembers which block was at the top, and how far into it you were, and
puts that spot back. A new article starts at the top.

## Coordination with the engine
- Content arrives through the media inbox (`src/apps/mediaInbox.ts`). Producers
  call `showInWidget(payload, useDesktopCommands())`, which stores the payload
  (persisted as `nexus-media-v1`) and opens this widget.
- Today the producer is the browser's "open as widget" chip on an article page.
  The engine's `run.response.widgets` and `fetch_article` results should go
  through the same `showInWidget`.
- The payload is the `article` variant of `WidgetPayload` (`src/types/agentEvents.ts`),
  shared with `apps/engine/backend/schemas/contracts.py`.

## Tech Stack
- React 19 + TypeScript + Vite
- UI library: `ArticleReader`, `EmptyState` (from `@/ui`)

## Folder Layout
```
internal-apps/reader/
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.tsx
│       ├── App.test.tsx
│       └── reader.css
└── backend/
    └── README.md
```

## Registry Entry
`reader`: sizes `1x2`, `2x2`, `4x2`, default `2x2`, plus a fullscreen view.
Aliases: reader, article, reading. It doesn't use bare "read", so "read my notes"
still opens notes.
