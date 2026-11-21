// Desktop state: which apps are open, where they sit on the grid, and how they're shown.
// Every command returns a short reply the agent can say back to the user.
//
// Persistence (./workspacePersistence.ts): every change is written to the localStorage
// cache at once and, debounced, to SQLite `workspaces.layout` through the engine's
// `persist_workspace`. On launch the cache paints the desk, then the SQLite copy
// restores it if newer. Without the engine the cache alone keeps the layout.

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { getApp, isAppId, nearestSize, type AppId } from '@/apps/registry'
import type { AppMode } from '@/apps/types'
import { COLS, ROWS, SIZE_DIMS, SIZE_ORDER, findSlot, fits, intersecting, isSize, pack, type Placement, type Size, type Slot } from './layout'
import {
  createEngineWorkspaceBackend,
  createWorkspaceSync,
  makeEnvelope,
  readCache,
  writeCache,
  type WorkspaceBackend,
} from './workspacePersistence'

export interface AppInstance extends Placement {
  appId: AppId
  mode: AppMode
  /** Playing its exit animation; removed from state once that finishes. */
  exiting?: boolean
}

export interface DesktopState {
  instances: AppInstance[]
  focusedId: string | null
}

/** A size, or one step up/down from the current size. */
export type SizeRequest = Size | 'up' | 'down'

const MODES: AppMode[] = ['widget', 'fullscreen', 'minimized']

let seq = 0
const newId = (appId: AppId) => `${appId}-${Date.now().toString(36)}${++seq}`

const instance = (appId: AppId, size: Size, slot: Slot): AppInstance => ({
  id: newId(appId),
  appId,
  size,
  ...slot,
  mode: 'widget',
})

/** First launch: a rich, mixed desk — nearly every app, one per cell group. */
export function defaultDesktop(): DesktopState {
  return {
    instances: [
      instance('clock', '2x2', { col: 0, row: 0 }),
      instance('browser', '2x2', { col: 2, row: 0 }),
      instance('notes', '2x1', { col: 4, row: 0 }),
      instance('gallery', '1x2', { col: 4, row: 1 }),
      instance('timer', '1x1', { col: 5, row: 1 }),
      instance('wm', '2x1', { col: 0, row: 2 }),
      instance('files', '2x1', { col: 2, row: 2 }),
      instance('monitor', '1x1', { col: 5, row: 2 }),
      instance('calendar', '2x1', { col: 0, row: 3 }),
      instance('settings', '1x1', { col: 2, row: 3 }),
      instance('terminal', '2x1', { col: 3, row: 3 }),
    ],
    focusedId: null,
  }
}

export type DesktopStore = ReturnType<typeof createDesktopStore>

export function createDesktopStore(initial: DesktopState) {
  let state = initial
  const listeners = new Set<() => void>()

  const set = (next: DesktopState) => {
    state = next
    save(next)
    listeners.forEach((l) => l())
  }

  // --- queries ---

  const live = () => state.instances.filter((i) => !i.exiting)
  /** Instances taking up grid cells. A fullscreen app keeps its cell for when it returns. */
  const onGrid = () => live().filter((i) => i.mode !== 'minimized')
  const find = (appId: AppId) => live().find((i) => i.appId === appId)

  // --- updates ---

  /** Merges changed instances (matched by id) back into state. */
  const update = (changed: AppInstance[], focusedId = state.focusedId) => {
    const byId = new Map(changed.map((c) => [c.id, c]))
    const known = new Set(state.instances.map((i) => i.id))
    set({
      instances: [...state.instances.map((i) => byId.get(i.id) ?? i), ...changed.filter((c) => !known.has(c.id))],
      focusedId,
    })
  }

  /** Puts `it` on the grid at `size`: its own spot if free, else any free spot, else repack everything. */
  const place = (it: AppInstance, size: Size): 'placed' | 'packed' | null => {
    const others = onGrid().filter((i) => i.id !== it.id)
    const slot = findSlot(others, size, undefined, { col: it.col, row: it.row })
    if (slot) {
      update([{ ...it, size, ...slot, mode: it.mode === 'minimized' ? 'widget' : it.mode }], it.id)
      return 'placed'
    }
    const packed = pack([...others, { ...it, size, mode: it.mode === 'minimized' ? 'widget' : it.mode }])
    if (!packed) return null
    update(packed, it.id)
    return 'packed'
  }

  const resolveSize = (appId: AppId, current: Size, req: SizeRequest): Size => {
    if (req !== 'up' && req !== 'down') return nearestSize(appId, req)
    const sizes = [...getApp(appId).sizes].sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b))
    const idx = sizes.indexOf(current)
    return sizes[Math.min(sizes.length - 1, Math.max(0, idx + (req === 'up' ? 1 : -1)))]
  }

  // --- commands ---

  const open = (appId: AppId, req?: SizeRequest): string => {
    const { label, defaultSize } = getApp(appId)
    const existing = find(appId)
    if (existing?.mode === 'minimized') return restore(appId)
    if (existing) {
      if (req) return resize(appId, req)
      update([], existing.id)
      return `${label} is already here.`
    }
    const size = req && req !== 'up' && req !== 'down' ? nearestSize(appId, req) : defaultSize
    const slot = findSlot(onGrid(), size)
    const fresh = instance(appId, size, slot ?? { col: 0, row: 0 })
    if (slot) {
      update([fresh], fresh.id)
      return `placed ${label}.`
    }
    const packed = pack([...onGrid(), fresh])
    if (!packed) return `no room for ${label}. hide something first.`
    update(packed, fresh.id)
    return `made room and placed ${label}.`
  }

  const close = (appId: AppId): string => {
    const { label } = getApp(appId)
    const it = find(appId)
    if (!it) return `${label} isn't open.`
    // Minimized apps aren't on screen, so there's nothing to animate.
    if (it.mode === 'minimized') remove(it.id)
    else update([{ ...it, exiting: true }], state.focusedId === it.id ? null : state.focusedId)
    return `closed ${label}.`
  }

  const closeAll = (): string => {
    if (live().length === 0) return 'nothing to close.'
    set({
      instances: state.instances
        .filter((i) => i.mode !== 'minimized' || i.exiting)
        .map((i) => ({ ...i, exiting: true })),
      focusedId: null,
    })
    return 'cleared the desk.'
  }

  /** Drops an instance from state. The grid calls this when an exit animation finishes. */
  const remove = (id: string) => {
    set({
      instances: state.instances.filter((i) => i.id !== id),
      focusedId: state.focusedId === id ? null : state.focusedId,
    })
  }

  const resize = (appId: AppId, req: SizeRequest): string => {
    const { label } = getApp(appId)
    const it = find(appId)
    if (!it) return open(appId, req)
    const size = resolveSize(appId, it.size, req)
    if (size === it.size) return `${label} is already ${size}.`
    if (it.mode === 'minimized') {
      update([{ ...it, size }])
      return `${label} will be ${size} when restored.`
    }
    const result = place(it, size)
    if (result === 'placed') return `${label} is now ${size}.`
    if (result === 'packed') return `rearranged to make ${label} ${size}.`
    return `not enough room to make ${label} ${size}.`
  }

  /** Drag-resize: set an exact size, in place. Never rearranges the desk. */
  const setSize = (appId: AppId, size: Size): string => {
    const { label, sizes } = getApp(appId)
    const it = find(appId)
    if (!it) return `${label} isn't open.`
    if (!sizes.includes(size)) return `${label} can't be ${size}.`
    if (size === it.size) return `${label} is already ${size}.`
    if (it.mode === 'minimized') {
      update([{ ...it, size }])
      return `${label} will be ${size} when restored.`
    }
    const others = onGrid().filter((o) => o.id !== it.id)
    if (!fits(others, size, it)) return `not enough room to make ${label} ${size}.`
    update([{ ...it, size }], it.id)
    return `${label} is now ${size}.`
  }

  const minimize = (appId: AppId): string => {
    const { label } = getApp(appId)
    const it = find(appId)
    if (!it) return `${label} isn't open.`
    if (it.mode === 'minimized') return `${label} is already minimized.`
    update([{ ...it, mode: 'minimized' }], state.focusedId === it.id ? null : state.focusedId)
    return `minimized ${label}.`
  }

  const restore = (appId: AppId): string => {
    const { label } = getApp(appId)
    const it = find(appId)
    if (!it) return `${label} isn't open.`
    if (it.mode !== 'minimized') {
      update([], it.id)
      return `${label} is already on screen.`
    }
    const result = place(it, it.size)
    if (result) return `restored ${label}.`
    return `no room to restore ${label}. hide something first.`
  }

  const fullscreen = (appId: AppId): string => {
    const { label, fullscreen: supported } = getApp(appId)
    if (!supported) return `${label} doesn't have a fullscreen view.`
    let it = find(appId)
    if (!it || it.mode === 'minimized') {
      const reply = it ? restore(appId) : open(appId)
      it = find(appId)
      if (!it || it.mode === 'minimized') return reply
    }
    if (it.mode === 'fullscreen') return `${label} is already fullscreen.`
    const others = live()
      .filter((i) => i.mode === 'fullscreen')
      .map((i) => ({ ...i, mode: 'widget' as const }))
    update([...others, { ...it, mode: 'fullscreen' }], it.id)
    return `${label} is fullscreen.`
  }

  const exitFullscreen = (): string => {
    const full = live().filter((i) => i.mode === 'fullscreen')
    if (full.length === 0) return 'nothing is fullscreen.'
    update(full.map((i) => ({ ...i, mode: 'widget' as const })))
    return 'back to the grid.'
  }

  const focus = (id: string) => {
    if (state.focusedId !== id) update([], id)
  }

  /** Drag-and-drop repositioning: a free cell takes the widget, an equal-size
   *  widget swaps with it, and a lone different-size widget steps aside. */
  const move = (appId: AppId, col: number, row: number): string => {
    const { label } = getApp(appId)
    const it = find(appId)
    if (!it) return `${label} isn't open.`
    if (it.mode === 'minimized') return `${label} is minimized — restore it first.`
    if (it.mode === 'fullscreen') return `${label} is fullscreen right now.`
    const d = SIZE_DIMS[it.size]
    const target = {
      col: Math.max(0, Math.min(COLS - d.w, col)),
      row: Math.max(0, Math.min(ROWS - d.h, row)),
    }
    if (target.col === it.col && target.row === it.row) return `${label} is already there.`

    const others = onGrid().filter((o) => o.id !== it.id)
    if (fits(others, it.size, target)) {
      update([{ ...it, ...target }], it.id)
      return `moved ${label}.`
    }

    const blockers = intersecting(others, it.size, target)
    if (blockers.length === 1) {
      const o = blockers[0]
      const rest = others.filter((x) => x.id !== o.id)
      // Room for the other widget is judged with the dragged one already sitting
      // at its target: the mover can't be parked on cells the dragged widget
      // still holds, and its own cells only count once it has left them.
      const occupied = [...rest, { ...it, ...target }]
      const home = { col: it.col, row: it.row }
      if (o.size === it.size && fits(occupied, o.size, home)) {
        update([{ ...it, ...target }, { ...o, ...home }], it.id)
        return `swapped ${label} and ${getApp(o.appId).label}.`
      }
      // Different footprints — or a half-step swap that would collide — so the
      // other widget re-homes: the spot just vacated first, then any free cell.
      // Never repack: a drag must not reshuffle the desk.
      const spot = fits(occupied, o.size, home) ? home : findSlot(occupied, o.size, undefined, home)
      if (spot) {
        update([{ ...it, ...target }, { ...o, ...spot }], it.id)
        return `moved ${label}; ${getApp(o.appId).label} stepped aside.`
      }
    }
    return `no room to put ${label} there.`
  }

  /** Replace the whole desk with a saved one (restore on launch). */
  const hydrate = (next: DesktopState) => {
    set({
      instances: next.instances.filter((i) => !i.exiting).map(({ exiting: _, ...rest }) => rest),
      focusedId: next.focusedId,
    })
  }

  const tidy = (): string => {
    const grid = onGrid()
    const packed = pack(grid)
    if (!packed || packed.every((p, i) => p.col === grid[i].col && p.row === grid[i].row)) return 'already tidy.'
    update(packed)
    return 'tidied up.'
  }

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    find,
    open,
    close,
    closeAll,
    remove,
    resize,
    setSize,
    minimize,
    restore,
    fullscreen,
    exitFullscreen,
    focus,
    move,
    tidy,
    hydrate,
  }
}

// --- persistence ---

/** Write-through to the localStorage cache. The SQLite copy is synced by the provider. */
function save(state: DesktopState) {
  writeCache(makeEnvelope(state))
}

/** Last cached desktop, cleaned up. Falls back to the default layout if it's missing or broken. */
export function loadDesktop(): DesktopState {
  const cached = readCache()
  return (cached && sanitizeDesktop(cached.session)) ?? defaultDesktop()
}

/**
 * Validate an untrusted saved desk (cache or SQLite). Drops unknown apps, sizes and
 * duplicates, and re-packs if the layout no longer fits. Null if it's unusable.
 */
export function sanitizeDesktop(raw: unknown): DesktopState | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as DesktopState).instances)) return null

  const seen = new Set<AppId>()
  const instances: AppInstance[] = []
  for (const r of (raw as DesktopState).instances as unknown[]) {
    if (!r || typeof r !== 'object') continue
    const { id, appId, size, col, row, mode } = r as Record<string, unknown>
    if (typeof id !== 'string' || !isAppId(appId) || seen.has(appId)) continue
    if (!isSize(size) || !getApp(appId).sizes.includes(size)) continue
    if (!Number.isInteger(col) || !Number.isInteger(row)) continue
    seen.add(appId)
    instances.push({
      id,
      appId,
      size,
      col: col as number,
      row: row as number,
      mode: MODES.includes(mode as AppMode) ? (mode as AppMode) : 'widget',
    })
  }

  // Re-place anything that no longer fits (e.g. the grid changed size since it was saved).
  const grid = instances.filter((i) => i.mode !== 'minimized')
  const valid = grid.every((it, idx) => fits(grid.slice(0, idx), it.size, it))
  if (!valid) {
    const packed = pack(grid)
    if (!packed) return null
    const byId = new Map(packed.map((p) => [p.id, p]))
    instances.forEach((it, idx) => (instances[idx] = byId.get(it.id) ?? it))
  }

  const focusedId = (raw as DesktopState).focusedId
  return {
    instances,
    focusedId: typeof focusedId === 'string' && instances.some((i) => i.id === focusedId) ? focusedId : null,
  }
}

// --- React binding ---

const DesktopContext = createContext<DesktopStore | null>(null)

const defaultBackend = (): WorkspaceBackend | null =>
  // Tests never reach a real engine (a dev engine on :8000 would get their layouts).
  import.meta.env.MODE === 'test' ? null : createEngineWorkspaceBackend()

export function DesktopProvider({
  children,
  initial,
  backend,
}: {
  children: ReactNode
  initial?: DesktopState
  /** Where the SQLite copy lives. Defaults to the engine; null keeps it localStorage-only. */
  backend?: WorkspaceBackend | null
}) {
  const [store] = useState(() => createDesktopStore(initial ?? loadDesktop()))
  const [remote] = useState(() => (backend === undefined ? defaultBackend() : backend))

  useEffect(() => {
    if (!remote) return
    const sync = createWorkspaceSync(store, { backend: remote, sanitize: sanitizeDesktop })
    void sync.start()
    const onPageHide = () => void sync.flush({ keepalive: true })
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onPageHide()
    }
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibility)
      sync.dispose()
    }
  }, [store, remote])

  return <DesktopContext.Provider value={store}>{children}</DesktopContext.Provider>
}

/** The desktop store plus its current state (re-renders on every change). */
export function useDesktop() {
  const store = useContext(DesktopContext)
  if (!store) throw new Error('useDesktop must be used inside <DesktopProvider>')
  const state = useSyncExternalStore(store.subscribe, store.getState)
  return { state, store }
}
