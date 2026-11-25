# Tools Internal App

## Purpose
The Tools manager (issue #30): every tool the agent can call, with its scope
(`read` / `mutate` / `network`), how policy gates it (`auto-approve` /
`needs approval` / `denied`), when it last ran, and a per-tool
**require approval** switch. Rows are `ToolCard`s with `meta` badges and a
`Switch` in `actions`.

The switch is **tighten-only**: you can make a tool ask first, never stop it
asking. Network and mutate tools always ask, so their switch is shown locked
on with the reason as a hint.

## Data
- **Live:** `GET /api/v1/tools` and `PATCH /api/v1/tools/{tool_id}`
  (`{require_approval}`) through `engineClient.listTools` /
  `setToolApproval`. The engine stores overrides in SQLite
  (`tool_policy_overrides`) and enforces them in `Policy` and in the gateway's
  read-only bypass, so a switched-on tool really interrupts for approval.
- **Offline:** `createFixtureSource()` mirrors the engine's 9 registered tools
  and keeps toggles in `localStorage` (`nexus-tools`), applying the same
  tighten-only rule.
- `withFallback` tries the engine on every load (1500 ms budget) and falls back
  to the fixture; the widget shows an `offline · fixture` badge when it does.
  Toggles go to whichever source served the last load, and offline toggles
  are not synced to the engine later.
- The widget makes its own `engineClient` until the shell shares one (#41).

## Tech Stack
- React 19 + TypeScript + Vite
- UI library: `ToolCard`, `Switch`, `Badge`, `MediaStates`, `ScrollArea`,
  `WidgetTemplate` (from `@/ui`)

## Folder Layout
```
internal-apps/tools/
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.tsx          ToolsApp (registry) + ToolsManager (pure view)
│       ├── source.ts        ToolsSource seam: fixture, engine, withFallback
│       ├── fixtures.ts      the registry as the engine reports it
│       ├── tools.css
│       ├── App.test.tsx
│       └── source.test.ts
└── backend/
    └── README.md
```

## Registry Entry
`tools` — sizes `2x1` (summary), `2x2` (list), `4x2` (list with
descriptions and lock hints), default `2x2`; no fullscreen.
Aliases: tools, tool manager, permissions, approvals.
