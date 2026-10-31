# Shell Frontend (Presentation Shell)

## Purpose
React 19 desktop shell hosted inside Tauri. Renders the ASCII-styled desktop: a dot-field background, a 6×4 snap grid of app widgets, and the agent prompt. There are no window title bars; the agent and the grid manage layout. Light and dark modes come from CSS tokens.

## Tech Stack
- React 19, TypeScript, plain CSS with tokens, Vite, MediaPipe Tasks Vision

## Folder Layout
```
apps/shell/frontend/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── main.tsx             # mounts <Desktop/>
│   ├── shell/               # Desktop, WidgetGrid, AppHost, DotField, PromptBar, Tray, agent/parseCommand
│   ├── wm/                  # layout.ts (grid packing), desktopStore.tsx (open/close/resize/minimize/fullscreen, saved to localStorage)
│   ├── apps/                # registry.ts: one AppDef per app (sizes, aliases, component)
│   ├── ui/                  # shared ASCII primitives (AsciiFrame) + ui.css
│   ├── theme/               # tokens.css, ThemeProvider (light/dark/system), useReducedMotion
│   ├── hooks/               # useIPC, useGesture
│   ├── internal-apps/       # clock, notes, files, terminal, system-monitor (frontend + backend each)
│   ├── vision/              # MediaPipe landmark detection
│   └── types/               # WindowState, IPC schemas
├── README.md
```

## How to Run
```powershell
cd apps/shell/frontend
npm install
npm run dev
```

## How to Add a Feature
1. New internal app → build it in `src/internal-apps/<app>/frontend` (component takes `AppProps`: `size`, `mode`, `instanceId`), then add an entry to `src/apps/registry.ts`. The grid, tray and agent pick it up from there.
2. Shared ASCII piece (meter, list, spinner) → `src/ui/`, styled only with theme tokens so it works in light and dark.
3. Desktop behavior (new layout action) → `src/wm/desktopStore.tsx`; agent wording for it → `src/shell/agent/parseCommand.ts`.
4. Hook → `src/hooks/`; type → `src/types/`.

## IPC / API Contracts
Consumes Tauri commands exposed by `src-tauri/src/commands/`. See `src/types/ipc.ts`.

## Testing
No test runner configured. Add Vitest + React Testing Library.
