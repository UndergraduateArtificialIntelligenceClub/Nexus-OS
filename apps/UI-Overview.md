# Nexus OS — Main Screen UI Overview

## Feel
A calm, ambient desktop. Quiet, light, uncluttered. The screen should feel like a
space you rest in, not a control panel.

## Core Principles
1. **Light background** — soft, low-contrast base.
2. **Hidden window manager** — users never see or touch window chrome. No title
   bars, no drag handles, no free-floating windows, no taskbar on the main screen.
3. **Coherent widgets** — every widget shares one visual style (same tokens for
   type, color, spacing, radius, borders). No widget brings its own look.
4. **ASCII as motion** — ASCII art is how widgets *move and appear*, not wallpaper.
5. **Design system** — tokens and component styling come from UI/UX Pro Max.

## Layout: Fixed Grid
- Widgets snap to a fixed grid; position and size are set by the system, never by
  dragging/resizing.
- Cell: 160px, gap: 16px (from the current clock demo).
- Widget sizes: 1x1, 2x1, 2x2 (every widget must look right at each size it supports).
- *(proposal)* Grid is centered with generous outer margin to keep the calm feel.

## ASCII Animations (built into widgets)
- **Build-in:** the widget's frame draws itself corner to corner (`+---` → full box),
  then content types in, then the frame settles into the final clean border.
- **Move:** when widgets rearrange, they travel between cells with an ASCII motion.
- *(proposal)* **Remove:** build-in played in reverse (content erases, frame un-draws).
- *(proposal)* Animations are short (well under a second) and respect a
  reduced-motion setting.

## Adding / Removing Widgets
- **Primary — ask the agent:** e.g. "show my notes", "hide the clock". The agent
  picks a free cell and the widget builds itself in.
- **Fallback — widget tray:** a hidden tray opened by a key shortcut lists available
  widgets; picking one auto-places it in the next free cell.
- *(proposal)* The agent input is a single quiet prompt line, not a chat window.

## Widgets
Existing stubs, all following the shared style: Clock (built), Notes, Files,
Terminal, System Monitor.

## Open Questions for Team Lead
- Is the agent prompt always visible, or summoned by a key?
- What happens when the grid is full?
- Do any apps ever need a full-screen / focused view beyond the grid?
- Exact key shortcut for the widget tray.
