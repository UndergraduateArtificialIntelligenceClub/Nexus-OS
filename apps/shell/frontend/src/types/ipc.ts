export type IPCCommand =
  | 'get_desktop_state'
  | 'open_app'
  | 'close_app'
  | 'move_window'
  | 'resize_window'
  | 'set_window_mode'
  | 'switch_workspace'
  | 'search_web'
  | 'fetch_article'
  | 'persist_workspace'

export interface IPCRequest {
  command: IPCCommand
  args: Record<string, unknown>
}

export interface IPCResponse {
  success: boolean
  data?: unknown
  error?: string
}
