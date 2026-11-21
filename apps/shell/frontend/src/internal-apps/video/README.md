# Video Internal App

## Purpose
The video widget: plays the last `video` payload sent to it, with the shell's own
ASCII controls (`VideoPlayer` from `@/ui`): play/pause glyph, an `AsciiSlider`
scrubber, a mono timecode, volume and mute. It never autoplays, and it pauses
whenever its widget is minimized or scrolled offscreen (`useMediaLifecycle`).

Keyboard, with focus anywhere in the player: Space or K plays and pauses, ← / →
seek 5s, ↑ / ↓ change the volume, M mutes. Esc stays with the shell.

## Coordination with the engine
- Content arrives through the media inbox (`src/apps/mediaInbox.ts`). Producers
  call `showInWidget(payload, useDesktopCommands())`, which stores the payload
  (persisted as `nexus-media-v1`) and opens this widget. If the desk is full it
  tries the smaller sizes before answering "no room".
- Today the producer is the browser's "open as widget" chip. The engine's
  `run.response.widgets` should go through the same `showInWidget`.
- The payload is the `video` variant of `WidgetPayload` (`src/types/agentEvents.ts`),
  shared with `apps/engine/backend/schemas/contracts.py`.
- Offline, the browser's fixture source points at the bundled clip
  `public/fixtures/test-pattern.mp4`. It's 5s of H.264/AAC at 320x180, which
  WebView2 and WKWebView both play.

## Tech Stack
- React 19 + TypeScript + Vite
- UI library: `VideoPlayer`, `EmptyState` (from `@/ui`)

## Folder Layout
```
internal-apps/video/
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.tsx
│       ├── App.test.tsx
│       └── video.css
└── backend/
    └── README.md
```

## Registry Entry
`video`: sizes `1x1` (play and time), `2x1` (controls beside the picture), `2x2`,
`4x2`, default `2x2`, plus a fullscreen view.
Aliases: video, player, movie, clip. It doesn't use "watch", which belongs to the clock.
