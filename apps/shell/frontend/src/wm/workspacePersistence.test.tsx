import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDesktopStore, DesktopProvider, defaultDesktop, sanitizeDesktop, useDesktop, type DesktopState } from './desktopStore'
import {
  WORKSPACE_STORAGE_KEY,
  createEngineWorkspaceBackend,
  createWorkspaceSync,
  makeEnvelope,
  readCache,
  type WorkspaceBackend,
  type WorkspaceEnvelope,
} from './workspacePersistence'

// SQLite-backed workspace persistence (issue #28): restore on launch from the
// engine's `workspaces` table, debounced persist_workspace, and the localStorage
// fallback when the engine is not running.

/** Same layout as tests/systems/fixtures/workspace_layout_v1.json (engine side). */
const SEEDED: WorkspaceEnvelope = {
  version: 1,
  savedAt: '2026-11-20T18:30:00.000Z',
  session: {
    instances: [
      { id: 'clock-seed1', appId: 'clock', size: '2x2', col: 0, row: 0, mode: 'widget' },
      { id: 'notes-seed2', appId: 'notes', size: '2x1', col: 2, row: 0, mode: 'fullscreen' },
      { id: 'timer-seed3', appId: 'timer', size: '1x1', col: 4, row: 0, mode: 'minimized' },
    ],
    focusedId: 'notes-seed2',
  },
}

/** Stands in for the engine: a `workspaces` table keyed by id, holding layout JSON text. */
function fakeEngine(seed: Record<string, unknown> = {}) {
  const table = new Map<string, string>(Object.entries(seed).map(([id, layout]) => [id, JSON.stringify(layout)]))
  const persisted: { id: string; name: string; layout: WorkspaceEnvelope; keepalive?: boolean }[] = []
  const backend: WorkspaceBackend = {
    persistWorkspace: vi.fn(async (id, name, layout, options) => {
      persisted.push({ id, name, layout, keepalive: options?.keepalive })
      table.set(id, JSON.stringify(layout))
    }),
    loadWorkspace: vi.fn(async (id) => {
      const text = table.get(id)
      return text === undefined ? null : JSON.parse(text)
    }),
  }
  return { backend, table, persisted, row: (id = 'default') => JSON.parse(table.get(id) ?? 'null') }
}

const offline = (): WorkspaceBackend => ({
  persistWorkspace: vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
  loadWorkspace: vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
})

const cacheLayout = (envelope: WorkspaceEnvelope) =>
  localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(envelope))

const appIds = (state: DesktopState) => state.instances.map((i) => i.appId)

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('restore on launch', () => {
  it('restores the layout from a pre-seeded DB when the local cache is empty', async () => {
    const engine = fakeEngine({ default: SEEDED })
    const store = createDesktopStore(defaultDesktop())
    const sync = createWorkspaceSync(store, { backend: engine.backend, sanitize: sanitizeDesktop })

    await expect(sync.start()).resolves.toBe('restored')

    expect(engine.backend.loadWorkspace).toHaveBeenCalledWith('default')
    expect(store.getState()).toEqual(SEEDED.session)
    // The restored desk is written back to the cache, so the next boot paints it at once.
    expect(readCache()?.session).toEqual(SEEDED.session)
    // Restoring is not a user change: nothing is pushed back.
    expect(engine.backend.persistWorkspace).not.toHaveBeenCalled()
    sync.dispose()
    expect(engine.backend.persistWorkspace).not.toHaveBeenCalled()
  })

  it('restores when the DB copy is newer than the cache', async () => {
    cacheLayout(makeEnvelope({ instances: [], focusedId: null }, new Date('2026-11-19T00:00:00Z')))
    const engine = fakeEngine({ default: SEEDED })
    const store = createDesktopStore({ instances: [], focusedId: null })
    const sync = createWorkspaceSync(store, { backend: engine.backend, sanitize: sanitizeDesktop })

    await expect(sync.start()).resolves.toBe('restored')
    expect(appIds(store.getState())).toEqual(['clock', 'notes', 'timer'])
    sync.dispose()
  })

  it('keeps the local layout and pushes it when the cache is newer', async () => {
    const local = makeEnvelope({ instances: [], focusedId: null }, new Date('2026-11-21T00:00:00Z'))
    cacheLayout(local)
    const engine = fakeEngine({ default: SEEDED })
    const store = createDesktopStore(local.session)
    const sync = createWorkspaceSync(store, { backend: engine.backend, sanitize: sanitizeDesktop })

    await expect(sync.start()).resolves.toBe('kept-local')
    expect(store.getState().instances).toEqual([])
    expect(engine.row().session).toEqual({ instances: [], focusedId: null })
    sync.dispose()
  })

  it('seeds an empty DB with the current layout', async () => {
    const engine = fakeEngine()
    const store = createDesktopStore(defaultDesktop())
    const sync = createWorkspaceSync(store, { backend: engine.backend, sanitize: sanitizeDesktop })

    await expect(sync.start()).resolves.toBe('seeded')
    expect(engine.persisted).toHaveLength(1)
    expect(engine.persisted[0]).toMatchObject({ id: 'default', name: 'Default', layout: { version: 1 } })
    expect(appIds(engine.row().session)).toEqual(appIds(store.getState()))
    sync.dispose()
  })

  it('treats an unknown-version or unusable DB envelope as empty', async () => {
    for (const bad of [
      { ...SEEDED, version: 99 },
      { version: 1, savedAt: SEEDED.savedAt, session: 'nope' },
      { version: 1, savedAt: SEEDED.savedAt, session: { windows: [] } },
    ]) {
      const engine = fakeEngine({ default: bad })
      const store = createDesktopStore(defaultDesktop())
      const before = appIds(store.getState())
      const sync = createWorkspaceSync(store, { backend: engine.backend, sanitize: sanitizeDesktop })
      await expect(sync.start()).resolves.toBe('seeded')
      expect(appIds(store.getState())).toEqual(before)
      sync.dispose()
    }
  })

  it('drops unknown apps from the DB copy like it does for the cache', async () => {
    const withGhost = {
      ...SEEDED,
      session: {
        ...SEEDED.session,
        instances: [...SEEDED.session.instances, { id: 'ghost', appId: 'ghost-app', size: '1x1', col: 5, row: 3, mode: 'widget' }],
      },
    }
    const engine = fakeEngine({ default: withGhost })
    const store = createDesktopStore(defaultDesktop())
    const sync = createWorkspaceSync(store, { backend: engine.backend, sanitize: sanitizeDesktop })
    await sync.start()
    expect(appIds(store.getState())).toEqual(['clock', 'notes', 'timer'])
    sync.dispose()
  })

  it('does not overwrite changes the user made while the load was in flight', async () => {
    const engine = fakeEngine({ default: SEEDED })
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const slow: WorkspaceBackend = {
      ...engine.backend,
      loadWorkspace: async (id) => {
        await gate
        return engine.backend.loadWorkspace(id)
      },
    }
    const store = createDesktopStore(defaultDesktop())
    const sync = createWorkspaceSync(store, { backend: slow, sanitize: sanitizeDesktop })

    const started = sync.start()
    store.closeAll()
    release()

    await expect(started).resolves.toBe('kept-local')
    // closeAll leaves instances playing their exit animation; none are live or saved.
    expect(store.getState().instances.filter((i) => !i.exiting)).toHaveLength(0)
    expect(engine.row().session.instances).toHaveLength(0)
    sync.dispose()
  })

  it('ignores a load that finishes after dispose', async () => {
    const engine = fakeEngine({ default: SEEDED })
    const store = createDesktopStore(defaultDesktop())
    const before = store.getState()
    const sync = createWorkspaceSync(store, { backend: engine.backend, sanitize: sanitizeDesktop })
    const started = sync.start()
    sync.dispose()
    await expect(started).resolves.toBe('disposed')
    expect(store.getState()).toBe(before)
  })
})

describe('persist_workspace', () => {
  it('debounces a burst of changes into one write of the latest layout', async () => {
    vi.useFakeTimers()
    const engine = fakeEngine({ default: SEEDED })
    const store = createDesktopStore(defaultDesktop())
    const sync = createWorkspaceSync(store, { backend: engine.backend, sanitize: sanitizeDesktop, debounceMs: 400 })

    store.minimize('clock')
    store.resize('monitor', 'up')
    store.focus(store.find('wm')!.id)
    expect(engine.backend.persistWorkspace).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(399)
    expect(engine.backend.persistWorkspace).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(engine.backend.persistWorkspace).toHaveBeenCalledTimes(1)

    const saved = engine.row().session as DesktopState
    expect(saved.instances.find((i) => i.appId === 'clock')).toMatchObject({ mode: 'minimized' })
    expect(saved.focusedId).toBe(store.find('wm')!.id)
    sync.dispose()
  })

  it('saves the same envelope that the localStorage cache holds', async () => {
    vi.useFakeTimers()
    const engine = fakeEngine()
    const store = createDesktopStore(defaultDesktop())
    const sync = createWorkspaceSync(store, { backend: engine.backend, sanitize: sanitizeDesktop })
    store.fullscreen('notes')
    await vi.advanceTimersByTimeAsync(400)

    const cached = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!)
    expect(Object.keys(engine.row()).sort()).toEqual(['savedAt', 'session', 'version'])
    expect(engine.row().session).toEqual(cached.session)
    expect(engine.row().version).toBe(cached.version)
    sync.dispose()
  })

  it('flush sends pending changes immediately with keepalive, and is a no-op when clean', async () => {
    vi.useFakeTimers()
    const engine = fakeEngine()
    const store = createDesktopStore(defaultDesktop())
    const sync = createWorkspaceSync(store, { backend: engine.backend, sanitize: sanitizeDesktop })

    await sync.flush({ keepalive: true })
    expect(engine.persisted).toHaveLength(0)

    store.minimize('clock')
    await sync.flush({ keepalive: true })
    expect(engine.persisted).toHaveLength(1)
    expect(engine.persisted[0].keepalive).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)
    expect(engine.persisted).toHaveLength(1) // the debounced write was cancelled
    sync.dispose()
  })

  it('dispose flushes unsaved changes', () => {
    const engine = fakeEngine()
    const store = createDesktopStore(defaultDesktop())
    const sync = createWorkspaceSync(store, { backend: engine.backend, sanitize: sanitizeDesktop })
    store.minimize('clock')
    sync.dispose()
    expect(engine.backend.persistWorkspace).toHaveBeenCalledTimes(1)
  })
})

describe('localStorage fallback without the engine', () => {
  it('keeps saving and restoring through localStorage when the engine is down', async () => {
    vi.useFakeTimers()
    const backend = offline()
    const store = createDesktopStore(defaultDesktop())
    const sync = createWorkspaceSync(store, { backend, sanitize: sanitizeDesktop })

    await expect(sync.start()).resolves.toBe('offline')
    store.minimize('clock')
    await vi.advanceTimersByTimeAsync(400)
    expect(backend.persistWorkspace).toHaveBeenCalledTimes(1) // tried, failed quietly

    // A relaunch with the engine still down restores from the cache.
    const relaunched = createDesktopStore(sanitizeDesktop(readCache()!.session)!)
    expect(relaunched.find('clock')).toMatchObject({ mode: 'minimized' })
    sync.dispose()
  })

  it('retries the engine on dispose after a failed write', async () => {
    vi.useFakeTimers()
    const backend = offline()
    const store = createDesktopStore(defaultDesktop())
    const sync = createWorkspaceSync(store, { backend, sanitize: sanitizeDesktop })
    store.minimize('clock')
    await vi.advanceTimersByTimeAsync(400)
    sync.dispose()
    expect(backend.persistWorkspace).toHaveBeenCalledTimes(2)
  })
})

describe('engine backend', () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('PUTs the envelope to /api/v1/workspaces/{id}', async () => {
    const fetchImpl = vi.fn(async () => json(200, { saved: true }))
    const backend = createEngineWorkspaceBackend({ baseUrl: 'http://engine.test/', fetchImpl })
    await backend.persistWorkspace('default', 'Default', SEEDED, { keepalive: true })

    expect(fetchImpl).toHaveBeenCalledWith('http://engine.test/api/v1/workspaces/default', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Default', layout: SEEDED }),
      keepalive: true,
    })
  })

  it('GET returns the stored layout, null on 404, and throws on other errors', async () => {
    const responses = [json(200, { workspace_id: 'default', name: 'Default', layout: SEEDED }), json(404, {}), json(500, {})]
    const fetchImpl = vi.fn(async () => responses.shift()!)
    const backend = createEngineWorkspaceBackend({ baseUrl: 'http://engine.test', fetchImpl })

    await expect(backend.loadWorkspace('default')).resolves.toEqual(SEEDED)
    await expect(backend.loadWorkspace('default')).resolves.toBeNull()
    await expect(backend.loadWorkspace('default')).rejects.toThrow('HTTP 500')
  })

  it('rejects when the engine is unreachable or refuses a write', async () => {
    const down = createEngineWorkspaceBackend({ fetchImpl: vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))) })
    await expect(down.loadWorkspace('default')).rejects.toThrow('Failed to fetch')
    const refuses = createEngineWorkspaceBackend({ fetchImpl: vi.fn(async () => json(400, {})) })
    await expect(refuses.persistWorkspace('default', 'Default', SEEDED)).rejects.toThrow('HTTP 400')
  })
})

describe('DesktopProvider', () => {
  function Probe({ onState }: { onState: (s: DesktopState) => void }) {
    const { state } = useDesktop()
    onState(state)
    return null
  }

  it('restores the pre-seeded DB layout on mount', async () => {
    const engine = fakeEngine({ default: SEEDED })
    let latest: DesktopState | null = null
    render(
      <DesktopProvider backend={engine.backend}>
        <Probe onState={(s) => (latest = s)} />
      </DesktopProvider>,
    )
    await waitFor(() => expect(latest).toEqual(SEEDED.session))
  })

  it('flushes on pagehide', async () => {
    const engine = fakeEngine({ default: SEEDED })
    let desk: ReturnType<typeof useDesktop>['store'] | null = null
    function Grab() {
      desk = useDesktop().store
      return null
    }
    render(
      <DesktopProvider backend={engine.backend}>
        <Grab />
      </DesktopProvider>,
    )
    await waitFor(() => expect(desk!.find('notes')).toBeDefined())
    act(() => {
      desk!.minimize('clock')
    })
    window.dispatchEvent(new Event('pagehide'))
    await waitFor(() => expect(engine.persisted.at(-1)?.keepalive).toBe(true))
    expect(engine.row().session.instances.find((i: { appId: string }) => i.appId === 'clock')).toMatchObject({ mode: 'minimized' })
  })

  it('stays localStorage-only with backend={null}', () => {
    let latest: DesktopState | null = null
    render(
      <DesktopProvider backend={null}>
        <Probe onState={(s) => (latest = s)} />
      </DesktopProvider>,
    )
    expect(appIds(latest!)).toEqual(appIds(defaultDesktop()))
  })
})
