/**
 * Production desktop store provider (WM-A / Task A1).
 *
 * Drop-in replacement for MockDesktopProvider: same props, same
 * DesktopStoreAPI surface via useDesktopStore(). Persistence wiring is
 * marked for A2; the store handle context is for A3 IPC.
 */

import {
  createContext,
  useContext,
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
import { createDesktopStore, type DesktopStore } from '@/wm/desktopStore'
import {
  createSessionPersister,
  getDefaultStorage,
  loadSession,
  type SessionStorage,
} from '@/wm/sessionPersistence'
import type { Size } from '@/wm/snap'

interface DesktopProviderProps extends PropsWithChildren {
  /** Starting session. Defaults to the Notes + Files seed. Read once on mount. */
  initialSession?: DesktopSession
  /** Current canvas size; only used by `arrange()`. */
  canvasSize?: Size
  /**
   * Restore the last saved session on mount and save changes to storage.
   * An explicit `initialSession` still wins over the saved one.
   * Defaults to true for the production provider (A2).
   */
  persist?: boolean
  /** Storage used when `persist` is on. Defaults to localStorage. Read once on mount. */
  storage?: SessionStorage | null
}

const DesktopStoreHandleContext = createContext<DesktopStore | null>(null)

/**
 * Raw store handle for callers outside the render cycle (A3 IPC).
 * Prefer `useDesktopStore()` for UI.
 */
export function useDesktopStoreHandle(): DesktopStore {
  const store = useContext(DesktopStoreHandleContext)
  if (!store) {
    throw new Error('useDesktopStoreHandle must be used within a DesktopProvider')
  }
  return store
}

export function DesktopProvider({
  initialSession,
  canvasSize,
  persist = true,
  storage,
  children,
}: DesktopProviderProps) {
  const [resolvedStorage] = useState(() => (storage === undefined ? getDefaultStorage() : storage))

  const canvasSizeRef = useRef<Size | undefined>(canvasSize)
  useEffect(() => {
    canvasSizeRef.current = canvasSize
  }, [canvasSize])

  const [store] = useState(() =>
    createDesktopStore({
      initialSession:
        initialSession ?? (persist ? (loadSession(resolvedStorage) ?? undefined) : undefined),
      getCanvasSize: () => {
        const size = canvasSizeRef.current
        return size && size.width > 0 && size.height > 0 ? size : undefined
      },
    }),
  )

  // A2 persistence: reuse createSessionPersister against the real store.
  useEffect(() => {
    if (!persist) return
    const persister = createSessionPersister(store, { storage: resolvedStorage })
    const onHide = () => persister.flush()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') persister.flush()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      persister.dispose()
    }
  }, [persist, store, resolvedStorage])

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

  return (
    <DesktopStoreHandleContext.Provider value={store}>
      <DesktopStoreContextProvider value={value}>{children}</DesktopStoreContextProvider>
    </DesktopStoreHandleContext.Provider>
  )
}
