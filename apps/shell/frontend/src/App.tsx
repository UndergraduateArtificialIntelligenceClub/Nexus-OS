import { useState } from 'react'

import { Taskbar } from '@/components/Taskbar'
import { WorkspaceCanvas } from '@/components/WorkspaceCanvas'
import { DesktopProvider } from '@/wm/DesktopProvider'
import type { Size } from '@/wm/snap'

export const APP_NAME = 'NEXUS OS'

export function App() {
  const [canvasSize, setCanvasSize] = useState<Size>({ width: 0, height: 0 })

  // Real store + persist + IPC bridge (A1–A3). MockDesktopProvider remains for tests.
  return (
    <DesktopProvider canvasSize={canvasSize} persist>
      <div className="nexus-shell">
        <header className="nexus-header">
          {APP_NAME}
          <span className="nexus-header-badge">real store</span>
        </header>
        <WorkspaceCanvas onSizeChange={setCanvasSize} />
        <Taskbar canvasSize={canvasSize} />
      </div>
    </DesktopProvider>
  )
}
