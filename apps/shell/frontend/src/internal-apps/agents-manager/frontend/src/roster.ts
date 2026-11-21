// The roster seam. A source is either the bundled fixture (what the widget shows
// until the engine event bus lands) or a live store fed by the engine's
// ServerEvent union. The widget never invents agents: the wire contract has no
// per-agent identity yet (#54), so live events update the one UI agent.

import { WORKING, type TimelineTask } from '@/ui'
import type { AgentStateName, ServerEvent, TaskStatus } from '@/types/agentEvents'

export type RosterKind = 'fixture' | 'live'

export interface AgentRow {
  id: string
  label: string
  status: AgentStateName
  /** One honest line: what it is doing, waiting on, or why it failed. */
  activity: string
  /** When the current status began; null for idle or scheduled work. */
  since: number | null
  tasks: TimelineTask[]
}

export interface RosterSource {
  readonly kind: RosterKind
  rows(): readonly AgentRow[]
  subscribe(listener: () => void): () => void
  /** Live sources apply engine events; fixture sources ignore them. */
  apply(event: ServerEvent): void
}

/** The one agent the current wire contract can identify. */
export const UI_AGENT_ID = 'agent.nexus'

const LIVE_ACTIVITY: Record<AgentStateName, string> = {
  idle: 'waiting for a request',
  listening: 'listening for a request',
  thinking: 'thinking it through',
  acting: 'running a task',
  waiting: 'needs a decision',
  speaking: 'replying',
  error: 'the last run failed',
}

const TASK_WORD: Record<TaskStatus, string> = {
  queued: 'queued',
  running: 'running',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
}

/** The four duties from concepts.md §2, anchored to the clock the widget mounts. */
export function fixtureRoster(now = Date.now()): AgentRow[] {
  return [
    {
      id: 'agent.research',
      label: 'research-web',
      status: 'acting',
      activity: 'drafting the summary',
      since: now - 134_000,
      tasks: [
        { id: 'search', label: 'search the web', status: 'done' },
        { id: 'read', label: 'read three sources', status: 'done' },
        { id: 'write', label: 'draft the summary', status: 'running' },
      ],
    },
    {
      id: 'agent.index',
      label: 'file-indexer',
      status: 'waiting',
      activity: 'needs a decision on 12 new files',
      since: now - 40_000,
      tasks: [
        { id: 'scan', label: 'scan the documents folder', status: 'done' },
        { id: 'confirm', label: 'confirm 12 files', status: 'running' },
      ],
    },
    {
      id: 'agent.sync',
      label: 'nightly-sync',
      status: 'error',
      activity: 'source unreachable',
      since: now - 62_000,
      tasks: [{ id: 'fetch', label: 'fetch the source', status: 'failed' }],
    },
    {
      id: 'agent.brief',
      label: 'morning-brief',
      status: 'idle',
      activity: 'scheduled for 07:00',
      since: null,
      tasks: [],
    },
  ]
}

/** The live store starts with the one agent the wire contract can identify. */
export function liveRoster(_now = Date.now()): AgentRow[] {
  return [
    {
      id: UI_AGENT_ID,
      label: 'nexus',
      status: 'idle',
      activity: LIVE_ACTIVITY.idle,
      since: null,
      tasks: [],
    },
  ]
}

export function createRosterSource(
  kind: RosterKind,
  initial: readonly AgentRow[],
): RosterSource {
  let rows = initial
  const listeners = new Set<() => void>()

  return {
    kind,
    rows: () => rows,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    apply(event) {
      if (kind !== 'live') return
      const next = applyServerEvent(rows, event)
      if (next === rows) return
      rows = next
      for (const listener of [...listeners]) listener()
    },
  }
}

export function fixtureRosterSource(now = Date.now()): RosterSource {
  return createRosterSource('fixture', fixtureRoster(now))
}

export function liveRosterSource(now = Date.now()): RosterSource {
  return createRosterSource('live', liveRoster(now))
}

/** The widget's default until the shell has an engine event bus (#41 / #45). */
export function defaultRosterSource(now = Date.now()): RosterSource {
  return fixtureRosterSource(now)
}

/**
 * Folds a wire event into the UI agent's row. Pure: returns the same array when
 * nothing changed, so the external store does not notify on no-ops.
 */
export function applyServerEvent(
  rows: readonly AgentRow[],
  event: ServerEvent,
  now = Date.now(),
): readonly AgentRow[] {
  switch (event.type) {
    case 'agent.state':
      return updateUiAgent(rows, (row) => ({
        ...row,
        status: event.data.state,
        activity: LIVE_ACTIVITY[event.data.state],
        since:
          event.data.state === 'idle'
            ? null
            : row.status === event.data.state
              ? row.since
              : now,
      }))

    case 'task.progress': {
      const { task_id, tool_id, status } = event.data
      const label = tool_id ?? task_id
      return updateUiAgent(rows, (row) => {
        const known = row.tasks.some((task) => task.id === task_id)
        const tasks = known
          ? row.tasks.map((task) =>
              task.id === task_id ? { ...task, label, status } : task,
            )
          : [...row.tasks, { id: task_id, label, status }]
        return { ...row, activity: `${label} ${TASK_WORD[status]}`, tasks }
      })
    }

    case 'run.interrupt':
      return updateUiAgent(rows, (row) => ({
        ...row,
        status: 'waiting',
        activity: event.data.message,
        since: row.status === 'waiting' ? row.since : now,
      }))

    case 'run.completed':
      return updateUiAgent(rows, (row) => ({
        ...row,
        status: event.data.status === 'ok' ? 'idle' : 'error',
        activity:
          event.data.status === 'ok'
            ? 'finished the run'
            : `run ${event.data.status}`,
        since: event.data.status === 'ok' ? null : now,
      }))

    case 'run.error':
      return updateUiAgent(rows, (row) => ({
        ...row,
        status: 'error',
        activity: event.data.error.message,
        since: now,
      }))

    default:
      return rows
  }
}

function updateUiAgent(
  rows: readonly AgentRow[],
  update: (row: AgentRow) => AgentRow,
): readonly AgentRow[] {
  const index = rows.findIndex((row) => row.id === UI_AGENT_ID)
  if (index < 0) return rows

  const current = rows[index]
  const next = update(current)
  if (
    next.status === current.status &&
    next.activity === current.activity &&
    next.since === current.since &&
    next.tasks === current.tasks
  ) {
    return rows
  }

  const copy = rows.slice()
  copy[index] = next
  return copy
}

export interface RosterCounts {
  working: number
  waiting: number
  error: number
  idle: number
}

export function rosterCounts(rows: readonly AgentRow[]): RosterCounts {
  const counts: RosterCounts = { working: 0, waiting: 0, error: 0, idle: 0 }
  for (const row of rows) {
    if (row.status === 'error') counts.error += 1
    else if (row.status === 'waiting') counts.waiting += 1
    else if (WORKING.includes(row.status)) counts.working += 1
    else counts.idle += 1
  }
  return counts
}

/** The header's aggregate line. Zero categories stay quiet. */
export function rosterSummary(rows: readonly AgentRow[]): string {
  const counts = rosterCounts(rows)
  const parts: string[] = []
  if (counts.working) parts.push(`${counts.working} working`)
  if (counts.waiting) parts.push(`${counts.waiting} waiting`)
  if (counts.error) parts.push(`${counts.error} error`)
  return parts.length ? parts.join(' · ') : 'all quiet'
}

/** `2m14s`, `40s`, `1h02m`; an em dash when there is no active status. */
export function formatElapsed(since: number | null, now = Date.now()): string {
  if (since === null) return '—'
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
}
