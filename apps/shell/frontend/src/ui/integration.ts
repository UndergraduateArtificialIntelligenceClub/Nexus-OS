import { useCallback } from 'react'
import { useDesktop } from '@/wm/desktopStore'
import { getApp, type AppId } from '@/apps/registry'

// The WM integration seam: the one place the library reaches into the window
// manager, so apps never import `@/wm` directly (plan §6.2). It is thin and
// additive on purpose — the store keeps every capability; this only names the
// three requests an app may make about itself.

export interface AppActions {
  /** Fullscreen if the app declares support; otherwise a polite no-op reply. */
  requestFullscreen: () => string
  requestMinimize: () => string
  requestClose: () => string
}

/**
 * App-side window requests, routed through the store like every other command.
 * Commands answer with the same short replies the agent speaks; an app that wants
 * the reply spoken passes it to the agent layer (shell-owned) itself.
 */
export function useAppActions(appId: AppId): AppActions {
  const { store } = useDesktop()

  const requestFullscreen = useCallback(
    () => store.fullscreen(appId),
    [appId, store],
  )
  const requestMinimize = useCallback(() => store.minimize(appId), [appId, store])
  const requestClose = useCallback(() => store.close(appId), [appId, store])

  return { requestFullscreen, requestMinimize, requestClose }
}
