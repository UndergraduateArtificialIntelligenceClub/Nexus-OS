import { IPCCommand, IPCRequest } from '@/types/ipc'

export function useIPC() {
  async function send(command: IPCCommand, args: Record<string, unknown>) {
    const request: IPCRequest = { command, args }
    return window.__TAURI__.invoke('ipc_dispatch', { request })
  }
  return { send }
}
