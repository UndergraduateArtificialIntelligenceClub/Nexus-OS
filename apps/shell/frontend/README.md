# Shell Frontend (Presentation Shell)

## Purpose
React 19 desktop shell hosted inside Tauri. Renders the ASCII-styled desktop: a dot-field background, a 6×4 snap grid of app widgets, and floating glass chrome (menu bar, Spotlight, a dock that shows when needed, and the agent avatar). There are no window title bars; the agent and the grid manage layout. Light and dark modes come from CSS tokens. Product and design records: `PRODUCT.md`, `DESIGN.md`.

## Tech Stack
- React 19, TypeScript, plain CSS with tokens, Vite, MediaPipe Tasks Vision

## Folder Layout
```
apps/shell/frontend/
├── package.json
├── vite.config.ts           # + vitest config (jsdom, setup file)
├── tsconfig.json
├── src/
│   ├── main.tsx             # font + layer CSS imports, mounts <Desktop/>
│   ├── shell/               # Desktop (layers + global keys), WidgetGrid, DotField
│   │   ├── InstanceHost.tsx # renders each app once and moves it between grid / fullscreen / minimized without remounting (per-instance ErrorBoundary)
│   │   ├── hostNodes.ts     # the detached host nodes + FLIP claim/release
│   │   ├── chrome/          # MenuBar, AnchorPicker, Spotlight (⌘K), Dock, FullscreenHost + chrome.css
│   │   ├── avatar/          # AgentAvatar (drag/flick), AgentBubble (StreamingText), AvatarArt → AsciiFace
│   │   └── agent/           # agentStore (status, reply, avatar anchor), parseCommand, runCommand, engineClient (doc 07 client, tests)
│   ├── wm/                  # layout.ts (grid packing, pure fns) + layout.test.ts, desktopStore.tsx (external store, localStorage)
│   ├── apps/                # registry.ts: one AppDef per app (sizes, aliases, component)
│   ├── ui/                  # THE UI LIBRARY — public API is the `@/ui` barrel only
│   │   ├── tokens/          # tokens.css (v2) + motion.ts (DUR/FRAME_MS/TYPE_MS/STAY_MS)
│   │   ├── motion/          # spring.ts (Springs), timeline.ts (animate)
│   │   ├── ascii/           # AsciiFrame, AsciiSpinner, AsciiMeter, AsciiFace, glyphs
│   │   ├── components/      # Text, Button, Markers, Status, Input, Controls, Popover, Select, Layout
│   │   ├── overlays/        # Dialog, Toast, EmptyState, ErrorBoundary, ConfirmPanel, trapTab
│   │   ├── ai/              # AgentStatus, StreamingText, PromptInput, ActivityTimeline, ToolCard, InterruptPanel
│   │   ├── media/           # MediaSurface, MediaStates, SourceBadge, useMediaLifecycle
│   │   ├── templates/       # WidgetTemplate, AppTemplate
│   │   ├── integration.ts   # the sanctioned ui → wm/shell seam (useAppActions)
│   │   ├── testing/         # setup.ts, a11y.ts (matchMedia stub), fixtures.tsx
│   │   ├── index.ts         # barrel — import from '@/ui', never from ui/* folders
│   │   └── *.css            # one stylesheet per layer
│   ├── theme/               # ThemeProvider (light/dark/system), useReducedMotion
│   ├── hooks/               # useIPC, useGesture
│   ├── internal-apps/       # clock, notes, files, terminal, system-monitor, timer (frontend + backend each)
│   ├── vision/              # MediaPipe landmark detection
│   └── types/               # ipc.ts, agentEvents.ts (wire contract + WidgetPayload)
├── README.md
```

## How to Run
```powershell
cd apps/shell/frontend
npm install
npm run dev
```

## How to Add a Feature
1. New internal app → build it in `src/internal-apps/<app>/frontend` (component takes `AppProps`: `size`, `mode`, `instanceId`), then add an entry to `src/apps/registry.ts`. Use `AppTemplate`/`WidgetTemplate` and import everything else from `@/ui`. The grid, Spotlight, dock and agent pick it up from the registry. See `docs/ui-library/app-guide.md`.
2. New shared component → `src/ui/` (right layer: components → overlays → ai → media → templates), styled only with theme tokens so it works in light and dark, exported through `src/ui/index.ts`. Animations use the springs in `src/ui/motion/spring.ts` and must handle reduced motion.
3. Desktop behavior (new layout action) → `src/wm/desktopStore.tsx`. Agent wording → `src/shell/agent/parseCommand.ts`, and what the command does → `src/shell/agent/runCommand.ts`.
4. Floating chrome (anything that sits above the grid) → `src/shell/chrome/`, using `.nx-glass`. Glass never sits on glass: popovers inside chrome use a solid `--surface`.
5. Hook → `src/hooks/`; type → `src/types/`.

## Keys
- ⌘/Ctrl+K or `/`: Spotlight (ask Nexus or find an app). Clicking the avatar opens it too.
- ⌘/Ctrl+.: show the dock. ⌘/Ctrl+M: minimize the focused app. ⌘/Ctrl+Enter: fullscreen it. Esc: leave fullscreen.
- Arrow keys on the avatar move it between resting spots.

## IPC / API Contracts
Consumes Tauri commands exposed by `src-tauri/src/commands/`. See `src/types/ipc.ts`.

## Testing
Vitest + React Testing Library (jsdom), no globals:

```powershell
npm test          # vitest run
npm run typecheck # tsc --noEmit
npm run build     # vite build
```

- Test setup lives in `src/ui/testing/` (`setup.ts` installs the matchMedia and
  ResizeObserver/IntersectionObserver stubs and registers RTL cleanup; `a11y.ts`
  controls the reduced-motion/transparency/contrast preferences; `fixtures.tsx`
  has `renderWithProviders`).
- House style: explicit `import { describe, expect, it } from 'vitest'`; timer
  chains advance one `act()` per tick (React flushes effects at act exit).
- Pure logic (`wm/layout`, springs, command parsing) is tested without DOM;
  components get RTL interaction/keyboard tests.
