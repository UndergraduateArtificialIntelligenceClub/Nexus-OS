import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultRosterSource,
  engineRosterFeed,
  fixtureAgents,
  fixtureRosterSource,
  formatElapsed,
  liveRosterSource,
  mergeSnapshot,
  orderRows,
  rosterCounts,
  rosterSummary,
  toRow,
  upsertRow,
} from './roster'
import { T0, agent, fakeFeed, updated } from './testFeed'

const T1 = '2026-11-23T10:00:05Z'
const T2 = '2026-11-23T10:00:09Z'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('fixture roster', () => {
  it('uses the identity contract shape and covers every status', () => {
    const agents = fixtureAgents(Date.parse(T0))
    for (const item of agents) {
      expect(Object.keys(item).sort()).toEqual(
        ['agent_id', 'label', 'last_activity', 'owner_run_id', 'role', 'since', 'status', 'updated_at'],
      )
    }
    expect(new Set(agents.map((item) => item.status))).toEqual(
      new Set(['idle', 'running', 'waiting', 'done', 'error']),
    )
  })

  it('is static: kind fixture, never connects', () => {
    const source = fixtureRosterSource()
    const before = source.snapshot()
    source.start()()
    expect(source.kind).toBe('fixture')
    expect(before.connection).toBe('fixture')
    expect(source.snapshot()).toBe(before)
  })

  it('is the default source under test', () => {
    expect(defaultRosterSource().kind).toBe('fixture')
  })
})

describe('rows', () => {
  it('parses the wire identity', () => {
    expect(toRow(agent('task:a', { since: T0, updated_at: T1, last_activity: 'planned' }))).toEqual({
      id: 'task:a',
      role: 'recipe',
      label: 'task:a',
      status: 'running',
      since: Date.parse(T0),
      runId: 'run-1',
      activity: 'planned',
      updatedAt: Date.parse(T1),
    })
  })

  it('counts and summarizes only what needs attention', () => {
    const rows = fixtureAgents().map(toRow)
    expect(rosterCounts(rows)).toEqual({ idle: 1, running: 2, waiting: 2, done: 1, error: 2 })
    expect(rosterSummary(rows)).toBe('2 running · 2 waiting · 2 error')
    expect(rosterSummary([toRow(agent('a', { status: 'done' }))])).toBe('all quiet')
  })

  it('formats elapsed time', () => {
    expect(formatElapsed(null, 1_000)).toBe('—')
    expect(formatElapsed(950_000, 1_000_000)).toBe('50s')
    expect(formatElapsed(866_000, 1_000_000)).toBe('2m14s')
    expect(formatElapsed(0, 3_661_000)).toBe('1h01m')
  })

  it('groups rows by run, newest run first, creation order inside a run', () => {
    const rows = [
      agent('supervisor:run-1'),
      agent('task:1a'),
      agent('supervisor:run-2', { owner_run_id: 'run-2' }),
      agent('task:1b'),
      agent('task:2a', { owner_run_id: 'run-2' }),
    ].map(toRow)
    expect(orderRows(rows).map((row) => row.id)).toEqual([
      'supervisor:run-2',
      'task:2a',
      'supervisor:run-1',
      'task:1a',
      'task:1b',
    ])
  })
})

describe('upsertRow', () => {
  const rows = [toRow(agent('a')), toRow(agent('b'))]

  it('appends a new agent and replaces only the changed row', () => {
    expect(upsertRow(rows, toRow(agent('c'))).map((row) => row.id)).toEqual(['a', 'b', 'c'])

    const next = upsertRow(rows, toRow(agent('b', { status: 'done', updated_at: T1 })))
    expect(next[1].status).toBe('done')
    expect(next[0]).toBe(rows[0])
  })

  it('returns the same array for a repeat or an older event', () => {
    expect(upsertRow(rows, toRow(agent('a')))).toBe(rows)
    const newer = upsertRow(rows, toRow(agent('a', { status: 'done', updated_at: T2 })))
    expect(upsertRow(newer, toRow(agent('a', { status: 'waiting', updated_at: T1 })))).toBe(newer)
  })
})

describe('mergeSnapshot', () => {
  it('drops agents the engine no longer lists and keeps unchanged row objects', () => {
    const previous = [toRow(agent('a')), toRow(agent('gone'))]
    const merged = mergeSnapshot(previous, [toRow(agent('a'))], new Map())
    expect(merged.map((row) => row.id)).toEqual(['a'])
    expect(merged[0]).toBe(previous[0])
  })

  it('lets events received during the sync win over an older snapshot entry', () => {
    const fresh = new Map([
      ['a', toRow(agent('a', { status: 'done', updated_at: T2 }))],
      ['new', toRow(agent('new', { updated_at: T2 }))],
    ])
    const merged = mergeSnapshot([], [toRow(agent('a', { updated_at: T1 }))], fresh)
    expect(merged.map((row) => [row.id, row.status])).toEqual([
      ['a', 'done'],
      ['new', 'running'],
    ])
  })
})

describe('live roster source', () => {
  it('syncs on connect, then folds agent.updated events', async () => {
    const harness = fakeFeed()
    const source = liveRosterSource(harness.feed)
    const listener = vi.fn()
    source.subscribe(listener)
    source.start()

    expect(source.snapshot()).toMatchObject({ rows: [], connection: 'connecting' })
    harness.connect(true)
    harness.lists[0].resolve([agent('supervisor:run-1')])
    await flush()
    expect(source.snapshot()).toMatchObject({ connection: 'live', frozenAt: null })
    expect(source.snapshot().rows.map((row) => row.id)).toEqual(['supervisor:run-1'])

    harness.emit(updated(agent('task:1', { updated_at: T1, last_activity: 'Open application browser' })))
    expect(source.snapshot().rows.map((row) => row.activity)).toEqual(['working', 'Open application browser'])

    const calls = listener.mock.calls.length
    harness.emit({ type: 'agent.state', session_id: 'session', run_id: 'run-1', ts: T1, data: { state: 'thinking' } })
    harness.emit(updated(agent('task:1', { updated_at: T1, last_activity: 'Open application browser' })))
    expect(listener).toHaveBeenCalledTimes(calls)
  })

  it('freezes the last known rows when the connection drops, and resyncs on reconnect', async () => {
    const harness = fakeFeed()
    let clock = 5_000
    const source = liveRosterSource(harness.feed, () => clock)
    source.start()
    harness.connect(true)
    harness.lists[0].resolve([agent('a'), agent('b')])
    await flush()

    harness.connect(false)
    expect(source.snapshot()).toMatchObject({ connection: 'offline', frozenAt: 5_000 })
    expect(source.snapshot().rows.map((row) => row.id)).toEqual(['a', 'b'])

    clock = 9_000
    harness.connect(false) // a failed retry keeps the original freeze time
    expect(source.snapshot().frozenAt).toBe(5_000)

    harness.connect(true)
    expect(source.snapshot().connection).toBe('offline') // still frozen until the sync lands
    harness.lists[1].resolve([agent('b', { status: 'done', updated_at: T1 })])
    await flush()
    expect(source.snapshot()).toMatchObject({ connection: 'live', frozenAt: null })
    expect(source.snapshot().rows.map((row) => [row.id, row.status])).toEqual([['b', 'done']])
  })

  it('goes offline when the catch-up list fails, and ignores a sync from a dropped socket', async () => {
    const harness = fakeFeed()
    const source = liveRosterSource(harness.feed, () => 1_000)
    source.start()

    harness.connect(true)
    harness.lists[0].reject(new Error('HTTP 500'))
    await flush()
    expect(source.snapshot()).toMatchObject({ connection: 'offline', frozenAt: 1_000 })

    harness.connect(true)
    harness.connect(false)
    harness.lists[1].resolve([agent('stale')])
    await flush()
    expect(source.snapshot()).toMatchObject({ rows: [], connection: 'offline' })
  })

  it('closes the feed on stop and ignores anything after it', async () => {
    const harness = fakeFeed()
    const source = liveRosterSource(harness.feed)
    const stop = source.start()
    harness.connect(true)
    stop()
    expect(harness.close).toHaveBeenCalledTimes(1)

    harness.lists[0].resolve([agent('late')])
    harness.emit(updated(agent('late')))
    harness.connect(false)
    await flush()
    expect(source.snapshot()).toMatchObject({ rows: [], connection: 'connecting' })
  })
})

describe('engineRosterFeed', () => {
  const SESSION = '33333333-3333-3333-3333-333333333333'

  class FakeSocket {
    static OPEN = 1
    static instances: FakeSocket[] = []
    readyState = 0
    sent: string[] = []
    onopen: (() => void) | null = null
    onmessage: ((m: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    constructor(readonly url: string) {
      FakeSocket.instances.push(this)
    }
    send(text: string) {
      this.sent.push(text)
    }
    close() {
      this.readyState = 3
      this.onclose?.()
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists and listens in the given session without ever answering on the socket', async () => {
    FakeSocket.instances = []
    vi.stubGlobal('WebSocket', FakeSocket)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ agents: [agent('a')] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const feed = engineRosterFeed(SESSION)
    const onEvent = vi.fn()
    const onConnectionChange = vi.fn()
    const close = feed.open({ onEvent, onConnectionChange })

    const socket = FakeSocket.instances[0]
    expect(socket.url).toBe(`ws://127.0.0.1:8000/api/v1/ws?session_id=${SESSION}`)
    socket.readyState = 1
    socket.onopen?.()
    expect(onConnectionChange).toHaveBeenCalledWith(true)

    const command = { type: 'ui.command', session_id: SESSION, run_id: 'r1', ts: T0, data: { command_id: 'c1', action: 'open_app', app_id: null, data: {} } }
    socket.onmessage?.({ data: JSON.stringify(command) })
    await flush()
    expect(onEvent).toHaveBeenCalledWith(command)
    expect(socket.sent).toEqual([])

    await expect(feed.listAgents()).resolves.toEqual([agent('a')])
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(`http://127.0.0.1:8000/api/v1/agents?session_id=${SESSION}`)

    close()
    expect(onConnectionChange).toHaveBeenLastCalledWith(false)
  })
})
