import { describe, expect, it, vi } from 'vitest'
import type { ServerEvent } from '@/types/agentEvents'
import {
  UI_AGENT_ID,
  applyServerEvent,
  createRosterSource,
  fixtureRoster,
  formatElapsed,
  liveRoster,
  rosterCounts,
  rosterSummary,
} from './roster'

const stamp = '2026-11-21T00:00:00.000Z'

function event<T extends ServerEvent['type']>(
  type: T,
  data: Extract<ServerEvent, { type: T }>['data'],
): Extract<ServerEvent, { type: T }> {
  return { type, data, session_id: 'session', run_id: 'run', ts: stamp } as Extract<
    ServerEvent,
    { type: T }
  >
}

describe('fixture roster', () => {
  it('contains the concept duties with the required visible fields', () => {
    const rows = fixtureRoster(1_000_000)

    expect(rows).toHaveLength(4)
    expect(rows.map((row) => row.label)).toEqual([
      'research-web',
      'file-indexer',
      'nightly-sync',
      'morning-brief',
    ])
    for (const row of rows) {
      expect(row.id).toBeTruthy()
      expect(row.status).toBeTruthy()
      expect(row.activity).toBeTruthy()
    }
  })

  it('counts and summarizes only active categories', () => {
    const rows = fixtureRoster(1_000_000)
    expect(rosterCounts(rows)).toEqual({ working: 1, waiting: 1, error: 1, idle: 1 })
    expect(rosterSummary(rows)).toBe('1 working · 1 waiting · 1 error')
    expect(rosterSummary([])).toBe('all quiet')
  })

  it('formats elapsed activity honestly', () => {
    expect(formatElapsed(null, 1_000)).toBe('—')
    expect(formatElapsed(950_000, 1_000_000)).toBe('50s')
    expect(formatElapsed(866_000, 1_000_000)).toBe('2m14s')
    expect(formatElapsed(0, 3_661_000)).toBe('1h01m')
  })
})

describe('live roster reducer', () => {
  it('folds state, task, interrupt, completion, and error events into the UI agent', () => {
    let rows = liveRoster(1_000)
    rows = applyServerEvent(rows, event('agent.state', { state: 'thinking' }), 2_000) as typeof rows
    expect(rows[0]).toMatchObject({ status: 'thinking', activity: 'thinking it through', since: 2_000 })

    rows = applyServerEvent(
      rows,
      event('task.progress', { task_id: 'search', tool_id: 'web.search', status: 'running' }),
      3_000,
    ) as typeof rows
    expect(rows[0].activity).toBe('web.search running')
    expect(rows[0].tasks).toEqual([{ id: 'search', label: 'web.search', status: 'running' }])

    rows = applyServerEvent(rows, event('run.interrupt', { kind: 'clarify', message: 'choose a folder', options: [] }), 4_000) as typeof rows
    expect(rows[0]).toMatchObject({ status: 'waiting', activity: 'choose a folder', since: 4_000 })

    rows = applyServerEvent(rows, event('run.completed', { status: 'ok' }), 5_000) as typeof rows
    expect(rows[0]).toMatchObject({ status: 'idle', activity: 'finished the run', since: null })

    rows = applyServerEvent(rows, event('run.error', { error: { code: 'offline', message: 'source unreachable', details: {} } }), 6_000) as typeof rows
    expect(rows[0]).toMatchObject({ status: 'error', activity: 'source unreachable', since: 6_000 })
  })

  it('does not invent agents or change state for unrelated events', () => {
    const rows = liveRoster()
    const noOp = applyServerEvent(
      rows,
      event('ui.command', { command_id: 'cmd', action: 'open_app', app_id: 'notes', data: {} }),
    )
    expect(noOp).toBe(rows)
    expect(rows.map((row) => row.id)).toEqual([UI_AGENT_ID])
  })
})

describe('roster sources', () => {
  it('notifies subscribers only when a live event changes the roster', () => {
    const source = createRosterSource('live', liveRoster())
    const listener = vi.fn()
    const unsubscribe = source.subscribe(listener)

    source.apply(event('agent.state', { state: 'thinking' }))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(source.rows()[0].status).toBe('thinking')

    unsubscribe()
    source.apply(event('agent.state', { state: 'idle' }))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps fixtures read-only when events arrive', () => {
    const source = createRosterSource('fixture', fixtureRoster())
    const before = source.rows()
    source.apply(event('agent.state', { state: 'error' }))
    expect(source.rows()).toBe(before)
  })
})
