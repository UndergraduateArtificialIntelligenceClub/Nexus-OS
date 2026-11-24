// The roster seam. A source is either the bundled fixture (tests and offline
// development) or the live engine roster: `GET /api/v1/agents` to catch up,
// then `agent.updated` events (docs/agents-manager/agent-identity.md). Rows are
// exactly what the engine last reported - the widget never invents an agent,
// a status, or activity, and when the engine is unreachable the rows freeze.

import { createEngineClient } from '@/shell/agent/engineClient'
import { engineSessionId } from '@/shell/agent/engineSession'
import type { AgentIdentity, AgentStatus, ServerEvent } from '@/types/agentEvents'

export type RosterKind = 'fixture' | 'live'

/**
 * - `fixture`: bundled data, never live.
 * - `connecting`: the first sync with the engine is pending.
 * - `live`: synced; events keep the rows current.
 * - `offline`: the connection dropped or the sync failed. Rows are frozen at
 *   `frozenAt` until the next successful sync.
 */
export type RosterConnection = 'fixture' | 'connecting' | 'live' | 'offline'

/** One engine agent as the widget renders it (an `AgentIdentity` with parsed times). */
export interface AgentRow {
  id: string
  /** supervisor | discovery | knowledge | desktop | recipe */
  role: string
  label: string
  status: AgentStatus
  /** When the current status began (epoch ms). */
  since: number
  runId: string
  /** What it is doing now, or how it ended. */
  activity: string
  updatedAt: number
}

export interface RosterSnapshot {
  rows: readonly AgentRow[]
  connection: RosterConnection
  /** When the roster stopped being live; elapsed times stop here. */
  frozenAt: number | null
}

export interface RosterSource {
  readonly kind: RosterKind
  snapshot(): RosterSnapshot
  subscribe(listener: () => void): () => void
  /** Open the feed while a widget shows the roster. Returns the stop function. */
  start(): () => void
}

export interface FeedHandlers {
  onEvent(event: ServerEvent): void
  onConnectionChange(connected: boolean): void
}

/** What the live roster needs from the engine. */
export interface RosterFeed {
  listAgents(): Promise<AgentIdentity[]>
  /** Open the event stream; returns close. */
  open(handlers: FeedHandlers): () => void
}

export function toRow(agent: AgentIdentity): AgentRow {
  return {
    id: agent.agent_id,
    role: agent.role,
    label: agent.label,
    status: agent.status,
    since: Date.parse(agent.since),
    runId: agent.owner_run_id,
    activity: agent.last_activity,
    updatedAt: Date.parse(agent.updated_at),
  }
}

const sameRow = (a: AgentRow, b: AgentRow) =>
  a.status === b.status &&
  a.activity === b.activity &&
  a.since === b.since &&
  a.updatedAt === b.updatedAt &&
  a.label === b.label

/**
 * Upsert by agent id. Returns the same array when nothing changed, and keeps
 * every other row object, so only the changed row re-renders. An event older
 * than the row (it was in flight while a newer snapshot arrived) is ignored.
 */
export function upsertRow(rows: readonly AgentRow[], row: AgentRow): readonly AgentRow[] {
  const index = rows.findIndex((current) => current.id === row.id)
  if (index < 0) return [...rows, row]
  const current = rows[index]
  if (row.updatedAt < current.updatedAt || sameRow(current, row)) return rows
  const copy = rows.slice()
  copy[index] = row
  return copy
}

/**
 * The catch-up list replaces the roster: agents the engine no longer knows
 * (e.g. after a restart) disappear. Events received since the socket opened
 * win over an older snapshot entry. Unchanged rows keep their object.
 */
export function mergeSnapshot(
  previous: readonly AgentRow[],
  snapshot: readonly AgentRow[],
  fresh: ReadonlyMap<string, AgentRow>,
): AgentRow[] {
  const before = new Map(previous.map((row) => [row.id, row]))
  const keep = (row: AgentRow) => {
    const old = before.get(row.id)
    return old && sameRow(old, row) ? old : row
  }
  const listed = new Set(snapshot.map((row) => row.id))
  const merged = snapshot.map((row) => {
    const live = fresh.get(row.id)
    return keep(live && live.updatedAt >= row.updatedAt ? live : row)
  })
  for (const row of fresh.values()) if (!listed.has(row.id)) merged.push(keep(row))
  return merged
}

function createStore(initial: RosterSnapshot) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(next: RosterSnapshot) {
      state = next
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function fixtureRosterSource(agents: readonly AgentIdentity[] = fixtureAgents()): RosterSource {
  const snapshot: RosterSnapshot = { rows: agents.map(toRow), connection: 'fixture', frozenAt: null }
  return {
    kind: 'fixture',
    snapshot: () => snapshot,
    subscribe: () => () => {},
    start: () => () => {},
  }
}

export function liveRosterSource(feed: RosterFeed = engineRosterFeed(), now = Date.now): RosterSource {
  const store = createStore({ rows: [], connection: 'connecting', frozenAt: null })

  const freeze = () => {
    const state = store.get()
    store.set({ ...state, connection: 'offline', frozenAt: state.frozenAt ?? now() })
  }

  return {
    kind: 'live',
    snapshot: store.get,
    subscribe: store.subscribe,
    start() {
      let active = true
      let sync = 0
      // Agents reported by events since the socket opened.
      let fresh = new Map<string, AgentRow>()

      const close = feed.open({
        onEvent(event) {
          if (!active || event.type !== 'agent.updated') return
          const row = toRow(event.data)
          fresh.set(row.id, row)
          const state = store.get()
          const rows = upsertRow(state.rows, row)
          if (rows !== state.rows) store.set({ ...state, rows })
        },
        onConnectionChange(connected) {
          if (!active) return
          if (!connected) {
            sync += 1 // a sync still in flight belongs to the dropped socket
            freeze()
            return
          }
          fresh = new Map()
          const request = ++sync
          feed.listAgents().then(
            (agents) => {
              if (!active || request !== sync) return
              const rows = mergeSnapshot(store.get().rows, agents.map(toRow), fresh)
              store.set({ rows, connection: 'live', frozenAt: null })
            },
            () => {
              if (active && request === sync) freeze()
            },
          )
        },
      })

      return () => {
        active = false
        close()
      }
    },
  }
}

/** The engine feed: REST catch-up plus a listen-only socket in the shell's session. */
export function engineRosterFeed(sessionId = engineSessionId()): RosterFeed {
  const rest = createEngineClient({ sessionId, observeOnly: true })
  return {
    listAgents: rest.listAgents,
    open(handlers) {
      const client = createEngineClient({
        sessionId,
        observeOnly: true,
        onEvent: handlers.onEvent,
        onConnectionChange: handlers.onConnectionChange,
      })
      client.connect()
      return client.close
    },
  }
}

/**
 * Live everywhere except tests. `VITE_NEXUS_ROSTER=fixture` shows the bundled
 * roster for offline development; it is never a fallback for a lost engine.
 */
export function defaultRosterSource(): RosterSource {
  const fixture = import.meta.env.MODE === 'test' || import.meta.env.VITE_NEXUS_ROSTER === 'fixture'
  return fixture ? fixtureRosterSource() : liveRosterSource()
}

/**
 * Runs newest first; inside a run, the engine's creation order (the
 * supervisor, then its task agents). Labels repeat across runs ("supervisor"),
 * so the run grouping is what makes rows readable.
 */
export function orderRows(rows: readonly AgentRow[]): AgentRow[] {
  const runs = new Map<string, AgentRow[]>()
  for (const row of rows) {
    const group = runs.get(row.runId)
    if (group) group.push(row)
    else runs.set(row.runId, [row])
  }
  return [...runs.values()].reverse().flat()
}

export function rosterCounts(rows: readonly AgentRow[]): Record<AgentStatus, number> {
  const counts: Record<AgentStatus, number> = { idle: 0, running: 0, waiting: 0, done: 0, error: 0 }
  for (const row of rows) counts[row.status] += 1
  return counts
}

/** The header's aggregate line: only what needs attention. Zero categories stay quiet. */
export function rosterSummary(rows: readonly AgentRow[]): string {
  const counts = rosterCounts(rows)
  const parts: string[] = []
  if (counts.running) parts.push(`${counts.running} running`)
  if (counts.waiting) parts.push(`${counts.waiting} waiting`)
  if (counts.error) parts.push(`${counts.error} error`)
  return parts.length ? parts.join(' · ') : 'all quiet'
}

/** `2m14s`, `40s`, `1h02m`; an em dash when there is nothing to time. */
export function formatElapsed(since: number | null, now = Date.now()): string {
  if (since === null) return '—'
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
}

/** Three runs covering every status, in the contract's exact shape. */
export function fixtureAgents(now = Date.now()): AgentIdentity[] {
  const at = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString()
  const agent = (
    agent_id: string,
    role: string,
    label: string,
    status: AgentStatus,
    secondsAgo: number,
    owner_run_id: string,
    last_activity: string,
  ): AgentIdentity => ({
    agent_id,
    role,
    label,
    status,
    since: at(secondsAgo),
    owner_run_id,
    last_activity,
    updated_at: at(secondsAgo),
  })

  return [
    agent('supervisor:run-sync', 'supervisor', 'supervisor', 'error', 62, 'run-sync', 'source unreachable'),
    agent('task:req-sync:fetch', 'discovery', 'fetch the sync source', 'error', 62, 'run-sync', 'source unreachable'),
    agent('supervisor:run-open', 'supervisor', 'supervisor', 'waiting', 40, 'run-open',
      'Allow open_application (reversible_write) targeting app:browser'),
    agent('task:req-open:direct', 'recipe', 'Open application browser', 'waiting', 40, 'run-open',
      'Allow open_application (reversible_write) targeting app:browser'),
    agent('supervisor:run-research', 'supervisor', 'supervisor', 'running', 134, 'run-research',
      'summarize the latest notes on vector search'),
    agent('task:req-research:search', 'discovery', 'search the web for vector search notes', 'done', 95,
      'run-research', 'found three sources'),
    agent('task:req-research:read', 'knowledge', 'read and summarize three sources', 'running', 60,
      'run-research', 'read and summarize three sources'),
    agent('task:req-research:save', 'desktop', 'save the summary to notes', 'idle', 134, 'run-research', 'planned'),
  ]
}
