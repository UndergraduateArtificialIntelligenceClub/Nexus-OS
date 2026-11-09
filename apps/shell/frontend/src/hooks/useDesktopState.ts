/**
 * Legacy hook name for desktop window state (WM-A / Task A1).
 *
 * Prefer `useDesktopStore()` from `@/wm/DesktopStoreContext` for new code.
 * This wrapper keeps the old `windows` / `loading` shape for any remaining callers.
 */

import { useDesktopStore } from '@/wm/DesktopStoreContext'

export function useDesktopState() {
  const store = useDesktopStore()
  return { ...store, loading: false as const }
}
