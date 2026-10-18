export type WindowMode = 'minimized' | 'windowed' | 'fullscreen'

export interface WindowState {
  id: string
  appId: string
  title: string
  mode: WindowMode
  x: number
  y: number
  width: number
  height: number
  workspaceId: string
  monitor: number
  focused: boolean
  zIndex: number
  isExternal: boolean
  externalHandle?: string
}

export interface IPCMessage {
  type: string
  payload: unknown
  timestamp: number
}
