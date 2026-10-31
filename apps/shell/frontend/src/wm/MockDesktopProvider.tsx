/**
 * Reactive mock of the desktop store for WM-B UI work (Task D0-D1).
 *
 * Provides the complete frozen DesktopStoreAPI through Yash's
 * DesktopStoreContextProvider, so components only ever call useDesktopStore().
 * No persistence, no IPC. On glue day App.tsx swaps this for the real provider.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react'

import type { DesktopSession } from '@/types/WindowState'
import type { DesktopStoreAPI } from '@/wm/DesktopStoreAPI'
import { DesktopStoreContextProvider } from '@/wm/DesktopStoreContext'
import { createMockDesktopStore } from '@/wm/mockDesktopStore'
import type { Size } from '@/wm/snap'

interface MockDesktopProviderProps extends PropsWithChildren {
  /** Starting session. Defaults to the Notes + Files seed. Read once on mount. */
  initialSession?: DesktopSession
  /** Current canvas size; only used by `arrange()`. */
  canvasSize?: Size
}

export function MockDesktopProvider({
  initialSession,
  canvasSize,
  children,
}: MockDesktopProviderProps) {
  const canvasSizeRef = useRef<Size | undefined>(canvasSize)
  useEffect(() => {
    canvasSizeRef.current = canvasSize
  }, [canvasSize])

  const [store] = useState(() =>
    createMockDesktopStore({
      initialSession,
      getCanvasSize: () => {
        const size = canvasSizeRef.current
        return size && size.width > 0 && size.height > 0 ? size : undefined
      },
    }),
  )

  const session = useSyncExternalStore(store.subscribe, store.getState, store.getState)

  const value = useMemo<DesktopStoreAPI>(
    () => ({
      windows: session.windows,
      focusedId: session.focusedId,
      activeWorkspaceId: session.activeWorkspaceId,
      grid: session.grid,
      openApp: store.openApp,
      closeApp: store.closeApp,
      focusApp: store.focusApp,
      moveWindow: store.moveWindow,
      resizeWindow: store.resizeWindow,
      setMode: store.setMode,
      arrange: store.arrange,
      switchWorkspace: store.switchWorkspace,
      hydrate: store.hydrate,
      getSnapshot: store.getSnapshot,
    }),
    [session, store],
  )

  return <DesktopStoreContextProvider value={value}>{children}</DesktopStoreContextProvider>
}
