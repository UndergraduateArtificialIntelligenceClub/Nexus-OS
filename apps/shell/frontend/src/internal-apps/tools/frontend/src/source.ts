import type { EngineTool } from '@/types/agentEvents'
import type { EngineClient } from '@/shell/agent/engineClient'
import { FIXTURE_TOOLS } from './fixtures'

// The Tools manager's data seam. Live: the engine's GET/PATCH /api/v1/tools via
// engineClient. Offline: a fixture mirroring the registry, with the user's
// toggles kept in localStorage. `withFallback` picks one per load and says
// which, so the widget never passes fixture data off as the engine's.

export interface ToolsSource {
  list(): Promise<EngineTool[]>
  /** Tighten-only: `true` adds an approval requirement; `false` clears the
   *  user's override but never loosens a tool whose policy already asks. */
  setRequireApproval(toolId: string, requireApproval: boolean): Promise<EngineTool>
}

export type SourceMode = 'live' | 'offline'

export interface FallbackSource extends ToolsSource {
  /** Where the last successful list() came from; null before the first load. */
  readonly mode: SourceMode | null
}

// --- offline fixture ----------------------------------------------------------

export const STORAGE_KEY = 'nexus-tools'

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>
type Overrides = Record<string, boolean>

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function loadOverrides(storage: Storage | null): Overrides {
  try {
    const raw = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null')
    if (!raw || typeof raw.overrides !== 'object' || raw.overrides === null) return {}
    return Object.fromEntries(Object.entries(raw.overrides).filter(([, v]) => v === true)) as Overrides
  } catch {
    return {}
  }
}

function saveOverrides(storage: Storage | null, overrides: Overrides) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, overrides }))
  } catch {
    /* keep in memory */
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface FixtureOptions {
  storage?: Storage | null
  /** Artificial latency so loading states are real (default 240 ms). */
  delayMs?: number
  now?: () => number
}

/** The registry as the engine would report it, plus the user's local toggles.
 *  Applies the same tighten-only rule as the engine's Policy.static_outcome. */
export function createFixtureSource(options: FixtureOptions = {}): ToolsSource {
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  const delay = options.delayMs ?? 240
  const now = options.now ?? Date.now
  let overrides = loadOverrides(storage)

  const view = (id: string): EngineTool => {
    const base = FIXTURE_TOOLS.find((t) => t.tool_id === id)
    if (!base) throw new Error(`tool ${id} is not registered`)
    const { usedMinutesAgo, ...rest } = base
    const requireApproval = overrides[id] === true
    const policy =
      rest.availability !== 'enabled' ? 'denied' : requireApproval ? 'approval_required' : rest.policy
    return {
      ...rest,
      policy,
      require_approval: requireApproval,
      last_used_at: usedMinutesAgo === null ? null : new Date(now() - usedMinutesAgo * 60_000).toISOString(),
    }
  }

  return {
    async list() {
      await wait(delay)
      return FIXTURE_TOOLS.map((t) => view(t.tool_id))
    },
    async setRequireApproval(toolId, requireApproval) {
      await wait(delay / 2)
      view(toolId) // throws for unknown tools, like the engine's 404
      const next = { ...overrides }
      if (requireApproval) next[toolId] = true
      else delete next[toolId]
      overrides = next
      saveOverrides(storage, overrides)
      return view(toolId)
    },
  }
}

// --- live engine --------------------------------------------------------------

export function engineSource(client: Pick<EngineClient, 'listTools' | 'setToolApproval'>): ToolsSource {
  return {
    list: () => client.listTools(),
    setRequireApproval: (toolId, requireApproval) => client.setToolApproval(toolId, requireApproval),
  }
}

// --- live with offline fallback -------------------------------------------------

/** Same budget as wm/workspacePersistence.ts: a missing engine must not stall the widget. */
export const LOAD_TIMEOUT_MS = 1500

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`engine did not answer within ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** Try the engine on every load; fall back to the fixture when it is not
 *  reachable. Toggles go to whichever source served the last load, so an
 *  offline toggle never pretends to have reached the engine (and a failed
 *  live toggle surfaces as an error instead of being written locally). */
export function withFallback(
  primary: ToolsSource,
  fallback: ToolsSource,
  timeoutMs = LOAD_TIMEOUT_MS,
): FallbackSource {
  let mode: SourceMode | null = null
  return {
    get mode() {
      return mode
    },
    async list() {
      try {
        const tools = await withTimeout(primary.list(), timeoutMs)
        mode = 'live'
        return tools
      } catch {
        const tools = await fallback.list()
        mode = 'offline'
        return tools
      }
    },
    setRequireApproval(toolId, requireApproval) {
      return (mode === 'live' ? primary : fallback).setRequireApproval(toolId, requireApproval)
    },
  }
}
