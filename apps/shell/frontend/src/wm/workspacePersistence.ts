/**
 * SQLite-backed workspace persistence for the grid shell (issue #28).
 *
 * The layout lives in two places:
 *
 * - **SQLite `workspaces.layout`** (engine): the store of record, written by
 *   `persist_workspace` (`PUT /api/v1/workspaces/{id}`) and read on launch by
 *   the session load (`GET /api/v1/workspaces/{id}`).
 * - **localStorage `nexus-desktop-v1`**: a synchronous cache so the desk paints
 *   immediately on boot, and the fallback when the engine is not running.
 *
 * Both hold the same versioned envelope `{ version, savedAt, session }`, so
 * either copy can restore the other. On launch the newer copy wins, unless the
 * user has already changed the desk, in which case the local layout is kept
 * and pushed.
 */

import type { AppInstance, DesktopState } from './desktopStore'

export const WORKSPACE_STORAGE_KEY = 'nexus-desktop-v1'
export const WORKSPACE_SCHEMA_VERSION = 1
export const DEFAULT_WORKSPACE_ID = 'default'
export const DEFAULT_WORKSPACE_NAME = 'Default'
export const REMOTE_SAVE_DEBOUNCE_MS = 400
export const DEFAULT_ENGINE_URL = 'http://127.0.0.1:8000'
export const LOAD_TIMEOUT_MS = 1500

export interface WorkspaceEnvelope {
  version: number
  savedAt: string
  session: DesktopState
}

/** The subset of the Web Storage API we use. Lets tests pass an in-memory fake. */
export type CacheStorage = Pick<Storage, 'getItem' | 'setItem'>

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** window.localStorage, or null when unavailable (SSR, privacy mode throwing on access). */
export function defaultCache(): CacheStorage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

/** The state as it should be saved: no instances mid-exit, no `exiting` flags. */
export function toSaved(state: DesktopState): DesktopState {
  return {
    instances: state.instances
      .filter((i) => !i.exiting)
      .map(({ exiting: _, ...rest }): AppInstance => rest),
    focusedId: state.focusedId,
  }
}

export function makeEnvelope(state: DesktopState, now: Date = new Date()): WorkspaceEnvelope {
  return { version: WORKSPACE_SCHEMA_VERSION, savedAt: now.toISOString(), session: toSaved(state) }
}

export interface UnwrappedLayout {
  /** Untrusted; run it through `sanitizeDesktop` before use. */
  session: unknown
  /** Null for the pre-envelope format, which carries no timestamp. */
  savedAt: string | null
}

/**
 * Accept a v1 envelope, or the bare `{ instances, focusedId }` that
 * `nexus-desktop-v1` held before the envelope. Anything else (including an
 * envelope from an unknown schema version) is null.
 */
export function unwrapLayout(raw: unknown): UnwrappedLayout | null {
  if (!isObject(raw)) return null
  if ('version' in raw) {
    if (raw.version !== WORKSPACE_SCHEMA_VERSION || !isObject(raw.session)) return null
    return { session: raw.session, savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : null }
  }
  return Array.isArray(raw.instances) ? { session: raw, savedAt: null } : null
}

export function readCache(storage: CacheStorage | null = defaultCache()): UnwrappedLayout | null {
  if (!storage) return null
  try {
    return unwrapLayout(JSON.parse(storage.getItem(WORKSPACE_STORAGE_KEY) ?? 'null'))
  } catch {
    return null
  }
}

/** Returns false when storage is unavailable or full; the layout then lasts for this visit only. */
export function writeCache(envelope: WorkspaceEnvelope, storage: CacheStorage | null = defaultCache()): boolean {
  if (!storage) return false
  try {
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(envelope))
    return true
  } catch {
    return false
  }
}

// --- engine backend ---

export interface PersistOptions {
  /** Let the request outlive the page (pagehide flush). */
  keepalive?: boolean
}

export interface WorkspaceBackend {
  /** `persist_workspace`: write the envelope into SQLite `workspaces.layout`. Rejects on failure. */
  persistWorkspace(workspaceId: string, name: string, layout: WorkspaceEnvelope, options?: PersistOptions): Promise<void>
  /** Session load: the saved envelope (untrusted), or null when none is saved. Rejects when unreachable. */
  loadWorkspace(workspaceId: string): Promise<unknown | null>
}

export interface EngineBackendOptions {
  /** Default http://127.0.0.1:8000 (engine main.py), same as engineClient. */
  baseUrl?: string
  fetchImpl?: typeof fetch
  /** Give up on the launch load after this long so a hung engine can't stall restore. */
  timeoutMs?: number
}

export function createEngineWorkspaceBackend(options: EngineBackendOptions = {}): WorkspaceBackend {
  const baseUrl = (options.baseUrl ?? DEFAULT_ENGINE_URL).replace(/\/$/, '')
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args))
  const timeoutMs = options.timeoutMs ?? LOAD_TIMEOUT_MS
  const url = (id: string) => `${baseUrl}/api/v1/workspaces/${encodeURIComponent(id)}`

  return {
    async persistWorkspace(workspaceId, name, layout, persistOptions = {}) {
      const response = await doFetch(url(workspaceId), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, layout }),
        keepalive: persistOptions.keepalive,
      })
      if (!response.ok) throw new Error(`persist_workspace failed: HTTP ${response.status}`)
    },

    async loadWorkspace(workspaceId) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await doFetch(url(workspaceId), { signal: controller.signal })
        if (response.status === 404) return null
        if (!response.ok) throw new Error(`workspace load failed: HTTP ${response.status}`)
        const body: unknown = await response.json()
        return isObject(body) ? (body.layout ?? null) : null
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

// --- sync ---

export interface SyncableStore {
  getState(): DesktopState
  subscribe(listener: () => void): () => void
  /** Replace the whole desk (restore). */
  hydrate(state: DesktopState): void
}

export type RestoreResult =
  /** The DB copy was newer (or the cache was empty) and is now on screen. */
  | 'restored'
  /** The DB had an older copy; the local layout was kept and pushed. */
  | 'kept-local'
  /** The DB had nothing usable; the local layout was written to it. */
  | 'seeded'
  /** The engine is unreachable; localStorage carries on alone. */
  | 'offline'
  /** dispose() ran before the load finished. */
  | 'disposed'

export interface WorkspaceSyncOptions {
  backend: WorkspaceBackend
  /** Validate an untrusted saved session (desktopStore's `sanitizeDesktop`). */
  sanitize: (raw: unknown) => DesktopState | null
  storage?: CacheStorage | null
  workspaceId?: string
  name?: string
  debounceMs?: number
  now?: () => Date
}

export interface WorkspaceSync {
  /** Load from SQLite and restore if that copy is newer. Never rejects. */
  start(): Promise<RestoreResult>
  /** Push unsaved changes now (pagehide / tab hidden). */
  flush(options?: PersistOptions): Promise<void>
  /** Flush, then stop listening. */
  dispose(): void
}

const newer = (a: string | null, b: string | null): boolean => {
  const ta = a === null ? NaN : Date.parse(a)
  if (Number.isNaN(ta)) return false
  const tb = b === null ? NaN : Date.parse(b)
  return Number.isNaN(tb) || ta > tb
}

/**
 * Mirror the store into SQLite: debounced `persist_workspace` on every change,
 * plus restore-on-launch via `start()`. Every remote failure is swallowed:
 * the store and its localStorage cache keep working without the engine.
 */
export function createWorkspaceSync(store: SyncableStore, options: WorkspaceSyncOptions): WorkspaceSync {
  const { backend, sanitize } = options
  const storage = options.storage === undefined ? defaultCache() : options.storage
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID
  const name = options.name ?? DEFAULT_WORKSPACE_NAME
  const debounceMs = options.debounceMs ?? REMOTE_SAVE_DEBOUNCE_MS
  const now = options.now ?? (() => new Date())

  let disposed = false
  /** The user changed the desk since launch; a late restore must not overwrite that. */
  let touched = false
  /** Changes not yet sent to the engine. */
  let pending = false
  let applyingRemote = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const persist = async (persistOptions?: PersistOptions) => {
    clearTimer()
    pending = false
    try {
      await backend.persistWorkspace(workspaceId, name, makeEnvelope(store.getState(), now()), persistOptions)
    } catch {
      // Engine down or refused: localStorage already has this change. Try again on the next one.
      pending = true
    }
  }

  const unsubscribe = store.subscribe(() => {
    if (disposed || applyingRemote) return
    touched = true
    pending = true
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      void persist()
    }, debounceMs)
  })

  return {
    async start() {
      // Read the cache before the load: the store rewrites it on every change.
      const local = readCache(storage)
      let raw: unknown
      try {
        raw = await backend.loadWorkspace(workspaceId)
      } catch {
        return disposed ? 'disposed' : 'offline'
      }
      if (disposed) return 'disposed'

      const remote = raw == null ? null : unwrapLayout(raw)
      const remoteState = remote ? sanitize(remote.session) : null
      const remoteWins = remoteState !== null && !touched && (local === null || newer(remote!.savedAt, local.savedAt))

      if (remoteWins) {
        applyingRemote = true
        try {
          store.hydrate(remoteState)
        } finally {
          applyingRemote = false
        }
        return 'restored'
      }
      await persist()
      return remoteState ? 'kept-local' : 'seeded'
    },

    async flush(persistOptions) {
      if (disposed || !pending) return
      await persist(persistOptions)
    },

    dispose() {
      if (disposed) return
      if (pending) void persist()
      disposed = true
      clearTimer()
      unsubscribe()
    },
  }
}
