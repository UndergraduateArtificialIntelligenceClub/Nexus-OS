import React, { useState } from 'react'
import { WindowState } from '@/types/WindowState'
import { WindowFrame } from '@/components/WindowFrame'

export const APP_NAME = 'NEXUS OS'

const EMPTY_WINDOW: WindowState = {
  id: 'welcome',
  appId: 'nexus.welcome',
  title: 'Welcome to NEXUS OS',
  mode: 'windowed',
  x: 100,
  y: 100,
  width: 600,
  height: 400,
  workspaceId: 'default',
  monitor: 0,
  focused: true,
  zIndex: 1,
  isExternal: false,
}

export function App() {
  const [windows, setWindows] = useState<WindowState[]>([EMPTY_WINDOW])

  return (
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
          />
        ))}
      </main>
      <aside className="nexus-taskbar">{APP_NAME}</aside>
    </div>
  )
}
