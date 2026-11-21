# Window Manager Plan

> **Status: Superseded (Nov 2026).** The Phase-1 free-placement WM track
> (pixel `WindowState`, `DesktopStoreAPI`, drag/snap/taskbar) was replaced by
> the live **6×4 widget grid**. Issue
> [#33](https://github.com/UndergraduateArtificialIntelligenceClub/Nexus-OS/issues/33)
> removed the dead free-placement generation from the tree.

## Live architecture (one WM)

| Layer | Path | Role |
|-------|------|------|
| Store | [`apps/shell/frontend/src/wm/desktopStore.tsx`](../../apps/shell/frontend/src/wm/desktopStore.tsx) | `AppInstance[]` on the grid; modes `widget` / `fullscreen` / `minimized`; `localStorage` key `nexus-desktop-v1` |
| Layout math | [`apps/shell/frontend/src/wm/layout.ts`](../../apps/shell/frontend/src/wm/layout.ts) | Pure `fits` / `findSlot` / `pack` for a fixed 6×4 cell grid |
| Shell surface | [`apps/shell/frontend/src/shell/WidgetGrid.tsx`](../../apps/shell/frontend/src/shell/WidgetGrid.tsx) | Renders widget cells |
| Instance host | [`apps/shell/frontend/src/shell/InstanceHost.tsx`](../../apps/shell/frontend/src/shell/InstanceHost.tsx) | Stable detached nodes claimed by grid / fullscreen / keep-alive |
| WM widget | [`apps/shell/frontend/src/internal-apps/wm`](../../apps/shell/frontend/src/internal-apps/wm) | Live desk/list UI (`apps/registry.ts` → `wm`) |
| App catalog | [`apps/shell/frontend/src/apps/registry.ts`](../../apps/shell/frontend/src/apps/registry.ts) | Single registry for internal apps |

There is **no** free placement, window title bars, drag handles, permanent taskbar,
or `DesktopStoreAPI` mock/real split in the shell.

## Cross-runtime contract (kept, not rendered)

[`modules/window-state/types.ts`](../../modules/window-state/types.ts) remains the
shared `WindowState` / `DesktopSession` shape for Rust and the Python engine
(Phase-5 native windows and IPC contracts). The React shell does **not** import
or render that model.

## Related plans

- Active shell UI work: [`docs/ui-library/plan.md`](../ui-library/plan.md)
- Engine / IPC integration: [`docs/AI-Core/07-api-flow.md`](../AI-Core/07-api-flow.md)
- SQLite layout persistence (issue #28): shipped via [`workspacePersistence.ts`](../../apps/shell/frontend/src/wm/workspacePersistence.ts) (`nexus-desktop-v1` cache + engine `PUT/GET /api/v1/workspaces/{id}` → `workspaces.layout`)
