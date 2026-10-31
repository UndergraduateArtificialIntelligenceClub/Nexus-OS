import { useState } from 'react'
<<<<<<< HEAD

import { Taskbar } from '@/components/Taskbar'
import { WorkspaceCanvas } from '@/components/WorkspaceCanvas'
import { MockDesktopProvider } from '@/wm/MockDesktopProvider'
import type { Size } from '@/wm/snap'

export const APP_NAME = 'NEXUS OS'

export function App() {
  const [canvasSize, setCanvasSize] = useState<Size>({ width: 0, height: 0 })
=======
import { WindowState } from '@/types/WindowState'
import { WindowFrame } from '@/components/WindowFrame'
import { ClockWidget } from '@/internal-apps/clock/frontend/src/App'

export const APP_NAME = 'NEXUS OS'

// Temporary demo: one clock at each preset size (1x1, 2x1, 2x2 cells of 160px + 16px gap).
// Replace with the app registry + desktop store once they exist.
const clockWindow = (id: string, x: number, y: number, width: number, height: number, zIndex: number): WindowState => ({
  id,
  appId: 'nexus.clock',
  title: 'Clock',
  mode: 'windowed',
  x,
  y,
  width,
  height,
  workspaceId: 'default',
  monitor: 0,
  focused: false,
  zIndex,
  isExternal: false,
})

const DEMO_WINDOWS: WindowState[] = [
  clockWindow('clock-small', 40, 40, 160, 160, 1),
  clockWindow('clock-medium', 216, 40, 336, 160, 2),
  clockWindow('clock-large', 568, 40, 336, 336, 3),
]

function renderApp(w: WindowState) {
  switch (w.appId) {
    case 'nexus.clock':
      return <ClockWidget />
    default:
      return null
  }
}

export function App() {
  const [windows, setWindows] = useState<WindowState[]>(DEMO_WINDOWS)
>>>>>>> origin/main

  // Glue day: replace MockDesktopProvider with the real DesktopProvider.
  return (
<<<<<<< HEAD
    <MockDesktopProvider canvasSize={canvasSize}>
      <div className="nexus-shell">
        <header className="nexus-header">
          {APP_NAME}
          <span className="nexus-header-badge">mock store</span>
        </header>
        <WorkspaceCanvas onSizeChange={setCanvasSize} />
        <Taskbar canvasSize={canvasSize} />
      </div>
    </MockDesktopProvider>
=======
    <div className="nexus-shell">
      <header className="nexus-header">{APP_NAME}</header>
      <main className="nexus-canvas">
        {windows.map((w) => (
          <WindowFrame
            key={w.id}
            window={w}
            onMove={(id, x, y) =>
              setWindows((ws) => ws.map((wi) => (wi.id === id ? { ...wi, x, y } : wi)))
            }
            onResize={(id, wdt, hgt) =>
              setWindows((ws) => ws.map((wi) => (wi.id === id ? { ...wi, width: wdt, height: hgt } : wi)))
            }
          >
            {renderApp(w)}
          </WindowFrame>
        ))}
      </main>
      <aside className="nexus-taskbar">{APP_NAME}</aside>
    </div>
>>>>>>> origin/main
  )
}
