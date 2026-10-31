/**
 * Placeholder content for internal apps, keyed by appId (Task B1).
 * Real app UIs belong to the OS Layout track; this only decides what a
 * WindowFrame renders and what the taskbar can launch.
 */

import type { ComponentType } from 'react'

import { ClockWidget } from '@/internal-apps/clock/frontend/src/App'
import { FilesWidget } from '@/internal-apps/files/frontend/src/App'
import { NotesWidget } from '@/internal-apps/notes/frontend/src/App'
import { SystemMonitorWidget } from '@/internal-apps/system-monitor/frontend/src/App'
import { TerminalWidget } from '@/internal-apps/terminal/frontend/src/App'
import type { Size } from '@/wm/snap'

export interface AppDefinition {
  appId: string
  title: string
  Component: ComponentType
  defaultSize: Size
}

function SettingsPlaceholder() {
  return (
    <div className="nexus-app-placeholder">
      <h2>Settings</h2>
      <p>Settings stub. No options yet.</p>
    </div>
  )
}

export const APP_REGISTRY: readonly AppDefinition[] = [
  { appId: 'nexus.notes', title: 'Notes', Component: NotesWidget, defaultSize: { width: 520, height: 360 } },
  { appId: 'nexus.files', title: 'Files', Component: FilesWidget, defaultSize: { width: 560, height: 380 } },
  { appId: 'nexus.terminal', title: 'Terminal', Component: TerminalWidget, defaultSize: { width: 600, height: 340 } },
  {
    appId: 'nexus.system-monitor',
    title: 'System Monitor',
    Component: SystemMonitorWidget,
    defaultSize: { width: 480, height: 320 },
  },
  { appId: 'nexus.clock', title: 'Clock', Component: ClockWidget, defaultSize: { width: 336, height: 160 } },
  { appId: 'nexus.settings', title: 'Settings', Component: SettingsPlaceholder, defaultSize: { width: 480, height: 360 } },
]

export function getAppDefinition(appId: string): AppDefinition | undefined {
  return APP_REGISTRY.find((app) => app.appId === appId)
}
