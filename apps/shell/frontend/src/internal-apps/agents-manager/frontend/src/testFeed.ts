// Test helpers: wire identities and a roster feed the test drives by hand.

import { vi } from 'vitest'
import type { AgentIdentity, AgentUpdatedEvent, ServerEvent } from '@/types/agentEvents'
import type { FeedHandlers, RosterFeed } from './roster'

export const T0 = '2026-11-23T10:00:00Z'

export function agent(id: string, patch: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    agent_id: id,
    role: 'recipe',
    label: id,
    status: 'running',
    since: T0,
    owner_run_id: 'run-1',
    last_activity: 'working',
    updated_at: T0,
    ...patch,
  }
}

export function updated(data: AgentIdentity): AgentUpdatedEvent {
  return { type: 'agent.updated', session_id: 'session', run_id: data.owner_run_id, ts: data.updated_at, data }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Connection changes, events, and each `listAgents` response are resolved by the test. */
export function fakeFeed() {
  let handlers: FeedHandlers | null = null
  const lists: Array<ReturnType<typeof deferred<AgentIdentity[]>>> = []
  const close = vi.fn()
  const feed: RosterFeed = {
    listAgents: vi.fn(() => {
      const next = deferred<AgentIdentity[]>()
      lists.push(next)
      return next.promise
    }),
    open(next) {
      handlers = next
      return close
    },
  }
  return {
    feed,
    close,
    lists,
    connect: (connected: boolean) => handlers!.onConnectionChange(connected),
    emit: (event: ServerEvent) => handlers!.onEvent(event),
  }
}
