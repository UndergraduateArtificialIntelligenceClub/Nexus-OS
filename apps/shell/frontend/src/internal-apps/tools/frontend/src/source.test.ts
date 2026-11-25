import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineTool } from '@/types/agentEvents'
import { createFixtureSource, engineSource, LOAD_TIMEOUT_MS, STORAGE_KEY, withFallback, type ToolsSource } from './source'

const READ = ['document_read', 'file_search', 'memory_lookup', 'system_diagnostics']
const MUTATE = ['document_create', 'memory_save', 'open_application']
const NETWORK = ['fetch_page', 'search_web']

const ids = (tools: EngineTool[], pick: (t: EngineTool) => boolean) =>
  tools.filter(pick).map((t) => t.tool_id).sort()

const fixture = () => createFixtureSource({ delayMs: 0 })

describe('fixture tools source', () => {
  beforeEach(() => localStorage.clear())

  it('mirrors the engine registry: 9 tools with scope and default policy', async () => {
    const tools = await fixture().list()
    expect(tools).toHaveLength(9)
    expect(ids(tools, (t) => t.scope === 'read')).toEqual(READ)
    expect(ids(tools, (t) => t.scope === 'mutate')).toEqual(MUTATE)
    expect(ids(tools, (t) => t.scope === 'network')).toEqual(NETWORK)
    expect(ids(tools, (t) => t.policy === 'auto_approve')).toEqual(READ)
    expect(ids(tools, (t) => t.policy === 'approval_required')).toEqual([...MUTATE, ...NETWORK].sort())
    expect(ids(tools, (t) => !t.policy_locked)).toEqual(READ)
    expect(tools.every((t) => t.require_approval === false)).toBe(true)
  })

  it('reports last use relative to now, or null', async () => {
    const now = Date.parse('2026-11-21T12:00:00Z')
    const tools = await createFixtureSource({ delayMs: 0, now: () => now }).list()
    const diag = tools.find((t) => t.tool_id === 'system_diagnostics')!
    expect(diag.last_used_at).toBe('2026-11-21T11:56:00.000Z')
    expect(tools.find((t) => t.tool_id === 'document_read')!.last_used_at).toBeNull()
  })

  it('persists a require-approval toggle and reads it back on a fresh load', async () => {
    const updated = await fixture().setRequireApproval('file_search', true)
    expect(updated).toMatchObject({ policy: 'approval_required', require_approval: true })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ version: 1, overrides: { file_search: true } })

    const again = (await fixture().list()).find((t) => t.tool_id === 'file_search')!
    expect(again.policy).toBe('approval_required')

    const cleared = await fixture().setRequireApproval('file_search', false)
    expect(cleared).toMatchObject({ policy: 'auto_approve', require_approval: false })
  })

  it('never loosens a locked tool', async () => {
    const tool = await fixture().setRequireApproval('search_web', false)
    expect(tool).toMatchObject({ policy: 'approval_required', policy_locked: true })
  })

  it('rejects unknown tools like the engine 404', async () => {
    await expect(fixture().setRequireApproval('delete_everything', true)).rejects.toThrow(/not registered/)
  })

  it('ignores corrupt storage', async () => {
    localStorage.setItem(STORAGE_KEY, '{nope')
    expect((await fixture().list()).every((t) => !t.require_approval)).toBe(true)
  })

  it('keeps working without storage', async () => {
    const source = createFixtureSource({ delayMs: 0, storage: null })
    await expect(source.setRequireApproval('file_search', true)).resolves.toMatchObject({ require_approval: true })
  })
})

describe('engineSource', () => {
  it('delegates to engineClient', async () => {
    const tool = { tool_id: 'file_search' } as EngineTool
    const client = { listTools: vi.fn(async () => [tool]), setToolApproval: vi.fn(async () => tool) }
    const source = engineSource(client)
    await expect(source.list()).resolves.toEqual([tool])
    await source.setRequireApproval('file_search', true)
    expect(client.setToolApproval).toHaveBeenCalledWith('file_search', true)
  })
})

describe('withFallback', () => {
  afterEach(() => vi.useRealTimers())

  const fake = (tools: EngineTool[]): ToolsSource & { set: ReturnType<typeof vi.fn> } => {
    const set = vi.fn(async (id: string) => ({ ...tools[0], tool_id: id }))
    return { list: async () => tools, setRequireApproval: set, set }
  }
  const live = [{ tool_id: 'live_tool' } as EngineTool]
  const offline = [{ tool_id: 'fixture_tool' } as EngineTool]

  it('uses the engine when it answers', async () => {
    const primary = fake(live)
    const fallback = fake(offline)
    const source = withFallback(primary, fallback)
    expect(source.mode).toBeNull()
    await expect(source.list()).resolves.toEqual(live)
    expect(source.mode).toBe('live')
    await source.setRequireApproval('x', true)
    expect(primary.set).toHaveBeenCalled()
    expect(fallback.set).not.toHaveBeenCalled()
  })

  it('falls back to the fixture when the engine rejects', async () => {
    const fallback = fake(offline)
    const source = withFallback(
      { list: () => Promise.reject(new Error('ECONNREFUSED')), setRequireApproval: vi.fn() },
      fallback,
    )
    await expect(source.list()).resolves.toEqual(offline)
    expect(source.mode).toBe('offline')
    await source.setRequireApproval('x', true)
    expect(fallback.set).toHaveBeenCalled()
  })

  it('falls back when the engine does not answer in time', async () => {
    vi.useFakeTimers()
    const source = withFallback({ list: () => new Promise(() => {}), setRequireApproval: vi.fn() }, fake(offline))
    const listed = source.list()
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS + 1)
    await expect(listed).resolves.toEqual(offline)
    expect(source.mode).toBe('offline')
  })

  it('goes back to live once the engine is reachable again', async () => {
    let up = false
    const source = withFallback(
      { list: async () => (up ? live : Promise.reject(new Error('down'))), setRequireApproval: vi.fn() },
      fake(offline),
    )
    await source.list()
    expect(source.mode).toBe('offline')
    up = true
    await expect(source.list()).resolves.toEqual(live)
    expect(source.mode).toBe('live')
  })
})
