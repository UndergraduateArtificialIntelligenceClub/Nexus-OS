# Files Internal App

## Purpose
The built-in files browser. Inside Tauri it lists the real home folder through
`@tauri-apps/plugin-fs`; in a browser (`npm run dev`) it serves a bundled fixture
tree, marked `fixture` beside the breadcrumbs. Folders open in place with
breadcrumbs and an `‹ up` step; entries sort folders first, then by natural name.
Selecting a file previews it beside the list; the 1x1 layout swaps the list for
the preview.

Previews by type:

- markdown — rendered by the small safe parser in `markdown.tsx` (no raw HTML)
- plain text and safe code — mono, clipped past 256 KiB with a note
- images, video, audio — asset-protocol URL with native player controls
- everything else (PDF, DOCX, archives, ...) — kind, size, modified date, and an
  "open it with your system app" action when the platform allows it

## Tech Stack
- React 19 + TypeScript + Vite
- `@tauri-apps/plugin-fs` for directory reads and file stats
- `@tauri-apps/api/path` for home and path joins
- `@tauri-apps/plugin-opener` for handing unsupported files to the system
- Asset protocol (`convertFileSrc`) for images, video, and audio

## Folder Layout
```
internal-apps/files/
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.tsx              # list, breadcrumbs, selection, layout
│       ├── App.test.tsx
│       ├── source.ts            # FileSource seam: Tauri + fixture
│       ├── source.test.ts
│       ├── fileTypes.ts         # extension sets, glyphs, viewer mapping
│       ├── fileTypes.test.ts
│       ├── markdown.tsx         # safe markdown subset renderer
│       ├── markdown.test.tsx
│       ├── viewers.tsx          # per-type renderers + unsupported panel
│       ├── viewers.test.tsx
│       ├── files.css
│       └── __fixtures__/        # one file per preview kind
└── backend/
    └── README.md
```

## Data Seam
`source.ts` defines `FileSource`: `home`, `readDir`, `readText`, `assetUrl`,
`openPath`, plus `kind`/`rootLabel`/`canOpen`.

- `tauriSource()` — the real home folder via plugin-fs and the asset protocol.
- `fixtureSource` — a bundled tree (markdown, text, code, image, video, audio,
  PDF, archive) used by the browser and the tests.
- `defaultFileSource()` — picks Tauri when `isTauri()` is true, fixture otherwise.

## How to Add a Preview Type
1. Add the extensions to `fileTypes.ts` and map them to a viewer in `VIEWER`.
2. Add the renderer in `viewers.tsx` (or extend the unsupported metadata panel).
3. Add a fixture under `__fixtures__/` and wire it into `fixtureSource`.
4. Cover it in `viewers.test.tsx` and `App.test.tsx`.

## Permissions
`src-tauri/capabilities/default.json` grants directory and text reads on
`$HOME`/`$HOME/**`, app-storage writes under `$APPDATA/storage`, and
`opener:allow-open-path` on `$HOME/**`. `tauri.conf.json` enables the asset
protocol with the same home scope.

## Testing
Vitest + React Testing Library, no globals. `App.test.tsx` drives the widget
against `fixtureSource` (listing, navigation, every preview kind, the 1x1 swap,
error retry, empty folder); the remaining suites cover the classifier, markdown
parser, source contract, and individual renderers.
