// Test helpers: wire identities and a roster feed the test drives by hand.

import { vi } from 'vitest'
import type { AgentIdentity, AgentUpdatedEvent, Interrupt, RunView, ServerEvent } from '@/types/agentEvents'
import type { FeedHandlers, RosterFeed } from './roster'

export const T0 = '2026-11-23T10:00:00Z'

export const INTERRUPT: Interrupt = {
  kind: 'confirm',
  message: 'Allow open_application (reversible_write) targeting app:browser',
  options: ['yes', 'no'],
}

/** A run view in the contract's shape; the interrupt is what `open` surfaces (#58). */
export function runView(patch: Partial<RunView> = {}): RunView {
  return {
    run_id: 'run-1',
    session_id: 'session',
    source: 'text',
    status: 'awaiting_input',
    agent_state: 'waiting',
    route: null,
    request_ids: [],
    response: null,
    interrupt: INTERRUPT,
    errors: [],
    created_at: T0,
    updated_at: T0,
    ...patch,
  }
}

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
    command: vi.fn(() => Promise.resolve({})),
    getRun: vi.fn(() => Promise.resolve(runView())),
    resume: vi.fn(() => Promise.resolve(runView({ status: 'running', interrupt: null }))),
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
