import { WindowState } from '@/types/WindowState'

export function useDesktopState() {
  const windows: WindowState[] = []
  return { windows, loading: false }
}
