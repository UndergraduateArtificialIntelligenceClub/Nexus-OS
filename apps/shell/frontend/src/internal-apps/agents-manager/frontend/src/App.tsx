import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { AppProps } from '@/apps/types'
import type {
  AgentCommandVerb,
  AgentStateName,
  AgentStatus as EngineStatus,
  Interrupt,
} from '@/types/agentEvents'
import { AgentStatus, Badge, EmptyState, InterruptPanel, Label, Mono } from '@/ui'
import {
  defaultRosterSource,
  formatElapsed,
  orderRows,
  rosterSummary,
  verbsFor,
  type AgentRow,
  type AgentVerb,
  type RosterSource,
} from './roster'
import './agents-manager.css'

// The agents manager: a duty roster. One row per engine agent -
// [status] label · elapsed · activity - grouped by run, with the verbs the
// engine can honestly perform (#57) and waiting rows routed into the
// InterruptPanel (#58). It is still not a chat surface (the orb owns
// conversation) and not an engine settings page (concepts.md §5). The shell
// draws the frame; this renders content.

/** The avatar's glyph for each roster status; the word is always the roster's own. */
const GLYPH_STATE: Record<EngineStatus, AgentStateName> = {
  idle: 'idle',
  running: 'acting',
  waiting: 'waiting',
  paused: 'idle',
  done: 'idle',
  error: 'error',
}

/** The row's word for each verb (concepts.md §2 row anatomy). */
const VERB_LABEL: Record<AgentVerb, string> = {
  pause: 'pause',
  resume: 'resume',
  cancel: 'cancel',
  retry: 'retry',
  run_now: 'run now',
  open: 'open',
}

/** What a row shows while its verb is in flight, until the engine's own word lands. */
const OPTIMISTIC_STATUS: Record<AgentCommandVerb, EngineStatus> = {
  pause: 'paused',
  resume: 'running',
  cancel: 'done',
  retry: 'running',
  run_now: 'running',
}

/** One verb in flight: shown optimistically until the engine speaks or refuses. */
interface OptimisticVerb {
  verb: AgentCommandVerb
  status: EngineStatus
  /** The row as it was when the verb was sent; engine truth wins as soon as it changes. */
  row: AgentRow
}

/** A waiting row's interrupt, opened through the `open` verb (#58): the
 *  panel renders on the row that asked for it, never over the roster. */
interface InterruptPanelState {
  agentId: string
  runId: string
  interrupt: Interrupt | null
}

export function AgentsManagerApp(props: AppProps) {
  const [source] = useState(defaultRosterSource)
  return <AgentsManager {...props} source={source} />
}

export interface AgentsManagerProps extends AppProps {
  source: RosterSource
  /** Fixed clock for tests; elapsed times tick once a second when omitted. */
  now?: number
}

export function AgentsManager({ size, mode, source, now }: AgentsManagerProps) {
  const { rows, connection, frozenAt } = useSyncExternalStore(source.subscribe, source.snapshot)
  useEffect(() => source.start(), [source])

  const ordered = useMemo(() => orderRows(rows), [rows])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = ordered.find((row) => row.id === selectedId) ?? ordered[0] ?? null
  const split = mode === 'fullscreen' || size === '2x2' || size === '4x2'
  const frozen = connection === 'offline'
  const commands = source.commands
  // A source that can perform verbs enables them - the live engine's, or the
  // fixture's simulated one. Offline stays honest: nothing is clickable.
  const verbsEnabled = commands !== null && !frozen

  // Optimistic verbs (#57): a row shows its verb's status until the engine
  // speaks again - the agent.updated that follows replaces the row object -
  // or rejects the verb, which rolls the row back to the engine's last word.
  const [optimistic, setOptimistic] = useState<Record<string, OptimisticVerb>>({})
  // The interrupt a waiting row's `open` verb surfaced (#58).
  const [panel, setPanel] = useState<InterruptPanelState | null>(null)

  useEffect(() => {
    setOptimistic((current) => {
      let changed = false
      const next: Record<string, OptimisticVerb> = {}
      for (const [id, entry] of Object.entries(current)) {
        if (rows.find((candidate) => candidate.id === id) === entry.row) next[id] = entry
        else changed = true
      }
      return changed ? next : current
    })
  }, [rows])

  const onVerb = useCallback((row: AgentRow, verb: AgentVerb) => {
    if (!commands) return
    if (verb === 'open') {
      // #58: waiting rows deep-link into the engine's pending interrupt,
      // and the panel belongs to the row that opened it.
      setPanel({ agentId: row.id, runId: row.runId, interrupt: null })
      commands.getInterrupt(row.runId).then(
        (interrupt) => setPanel((current) => {
          if (!current || current.agentId !== row.id) return current
          // No pending decision: don't leave the row asking forever.
          return interrupt ? { ...current, interrupt } : null
        }),
        () => setPanel(null), // the engine would not say what it waits for: nothing to answer
      )
      return
    }
    const optimisticStatus = OPTIMISTIC_STATUS[verb]
    setOptimistic((current) => ({ ...current, [row.id]: { verb, status: optimisticStatus, row } }))
    commands.command(row.id, verb).then((result: unknown) => {
      // Policy-gated verbs (#57) are not applied yet: the engine raised its
      // own approval interrupt. Drop the optimistic status so the waiting row
      // (with its `open` verb, #58) tells the truth, not a fake completion.
      if (!result || typeof result !== 'object' || !('approval_required' in result)
        || !(result as { approval_required?: boolean }).approval_required) return
      setOptimistic((current) => {
        if (current[row.id]?.row !== row) return current
        const { [row.id]: _gated, ...rest } = current
        return rest
      })
    }, () => {
      // Engine rejection: roll the row back to the engine's last word.
      setOptimistic((current) => {
        if (current[row.id]?.row !== row) return current
        const { [row.id]: _rollback, ...rest } = current
        return rest
      })
    })
  }, [commands])

  // Stable between renders so the memoized rows only re-render for their own
  // changes (the perf suite counts AgentStatus renders to hold this line).
  const onResolve = useCallback((option: string) => {
    const current = panel
    if (!current) return
    setPanel(null)
    // Rows tell the truth: resolving transitions arrive as agent.updated
    // (approve -> running; deny -> a clean failure with the row's error state).
    commands?.resume(current.runId, option).catch(() => {})
  }, [panel, commands])

  return (
    <Clock fixed={frozen ? frozenAt : (now ?? null)}>
      <div
        className="w-agents"
        data-size={size}
        data-layout={split ? 'split' : 'compact'}
        data-source={source.kind}
        data-connection={connection}
      >
        <header className="w-agents-head">
          <div className="w-agents-heading">
            <Label>agents</Label>
            <Badge tone={connection === 'live' ? 'accent' : 'default'} data-testid="agents-source">
              {connection}
            </Badge>
          </div>
          <Mono as="span" className="w-agents-summary" data-testid="agents-summary">
            {rows.length} {rows.length === 1 ? 'agent' : 'agents'} · {rosterSummary(rows)}
          </Mono>
        </header>

        {frozen ? (
          <p className="w-agents-banner" role="status" data-testid="agents-offline">
            {rows.length && frozenAt !== null
              ? `engine offline · last known roster from ${clockTime(frozenAt)}`
              : 'engine offline · retrying'}
          </p>
        ) : null}

        {ordered.length === 0 ? (
          <EmptyState
            hint={connection === 'connecting' ? 'connecting to the engine' : 'no agents on the roster'}
            className="w-agents-empty"
          />
        ) : (
          <div className="w-agents-body">
            <ul className="w-agents-roster" aria-label="Agent roster">
              {ordered.map((row) => (
                <RosterRow
                  key={row.id}
                  row={row}
                  display={optimistic[row.id]?.status ?? row.status}
                  selected={row.id === selected?.id}
                  frozen={frozen}
                  verbsEnabled={verbsEnabled}
                  pending={optimistic[row.id] !== undefined}
                  interrupt={panel !== null && panel.agentId === row.id ? panel.interrupt : null}
                  interruptLoading={panel !== null && panel.agentId === row.id
                    && panel.interrupt === null}
                  onSelect={setSelectedId}
                  onVerb={onVerb}
                  onResolve={onResolve}
                />
              ))}
            </ul>

            {split && selected ? <AgentDetail row={selected} frozen={frozen} /> : null}
          </div>
        )}
      </div>
    </Clock>
  )
}

interface RosterRowProps {
  row: AgentRow
  /** The status the row shows: the optimistic verb's, else the engine's. */
  display: EngineStatus
  selected: boolean
  frozen: boolean
  /** Verbs need a live engine that accepts commands; a fixture never has one. */
  verbsEnabled: boolean
  /** A verb for this row is in flight: no second verb until the engine answers. */
  pending: boolean
  onSelect: (id: string) => void
  onVerb: (row: AgentRow, verb: AgentVerb) => void
  /** The interrupt this row opened (#58): rendered on the row that asked. */
  interrupt: Interrupt | null
  interruptLoading: boolean
  onResolve: (option: string) => void
}

/** Memoized: an `agent.updated` re-renders its own row only; time ticks re-render only `Elapsed`. */
const RosterRow = memo(function RosterRow({
  row,
  display,
  selected,
  frozen,
  verbsEnabled,
  pending,
  interrupt,
  interruptLoading,
  onSelect,
  onVerb,
  onResolve,
}: RosterRowProps) {
  const verbs = verbsFor(row)
  return (
    <li data-agent-id={row.id}>
      <button
        type="button"
        className="w-agents-row"
        data-status={display}
        data-kind={row.role === 'supervisor' ? 'supervisor' : 'task'}
        data-agent-id={row.id}
        aria-current={selected ? 'true' : undefined}
        title={`${row.label} · ${row.id}`}
        onClick={() => onSelect(row.id)}
      >
        <RosterStatus status={display} frozen={frozen} />
        <span className="w-agents-label">{row.label}</span>
        <Elapsed row={row} />
        <span className="w-agents-activity">{row.activity}</span>
        {/* A supervisor's label is its role; say it once and give the activity the room. */}
        {row.role !== row.label ? (
          <Mono as="span" className="w-agents-role">
            {row.role}
          </Mono>
        ) : null}
      </button>
      {verbs.length > 0 || row.status === 'waiting' ? (
        <div className="w-agents-actions" data-kind={row.role === 'supervisor' ? 'supervisor' : 'task'}>
          {row.status === 'waiting' ? (
            <span className="w-agents-decision">needs a decision</span>
          ) : null}
          {verbs.map((verb) => (
            <button
              key={verb}
              type="button"
              className="w-agents-verb"
              data-verb={verb}
              disabled={!verbsEnabled || pending}
              onClick={() => onVerb(row, verb)}
            >
              {VERB_LABEL[verb]}
            </button>
          ))}
        </div>
      ) : null}
      {interruptLoading ? (
        <p className="w-agents-interrupt-loading">asking the engine what it waits for…</p>
      ) : null}
      {interrupt ? (
        <div
          className="w-agents-interrupt"
          aria-label="agent interrupt"
          data-testid="agents-interrupt"
          data-run-id={row.runId}
          data-kind={row.role === 'supervisor' ? 'supervisor' : 'task'}
        >
          <InterruptPanel interrupt={interrupt} onResolve={onResolve} />
          {interrupt.options.length === 0 ? (
            <p className="w-agents-interrupt-hint">
              answer through the orb - the roster is not a chat surface
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  )
})

function AgentDetail({ row, frozen }: { row: AgentRow; frozen: boolean }) {
  return (
    <section
      className="w-agents-detail"
      aria-label={`${row.label} detail`}
      data-testid="agents-detail"
      data-agent-id={row.id}
    >
      <div className="w-agents-detail-head">
        <span className="w-agents-detail-label">{row.label}</span>
        <Mono as="span" className="w-agents-role">
          {row.role}
        </Mono>
      </div>

      <div className="w-agents-detail-status">
        <RosterStatus status={row.status} frozen={frozen} />
        <Elapsed row={row} />
      </div>

      <p className="w-agents-detail-activity">{row.activity}</p>

      <dl className="w-agents-facts">
        <dt>agent</dt>
        <dd>{row.id}</dd>
        <dt>run</dt>
        <dd>{row.runId}</dd>
      </dl>

      <p className="w-agents-note">rows speak the engine's word · verbs do only what the engine can perform</p>
    </section>
  )
}

/** A frozen row keeps its last word but drops the spinner: nothing is known to be moving. */
function RosterStatus({ status, frozen }: { status: EngineStatus; frozen: boolean }) {
  const state = frozen ? 'idle' : GLYPH_STATE[status]
  return <AgentStatus status={state} labels={{ [state]: status }} className="w-agents-state" />
}

const ClockContext = createContext(0)

/**
 * One clock for every elapsed cell. Its children are created by the parent,
 * so a tick re-renders only the context consumers, never the rows.
 */
function Clock({ fixed, children }: { fixed: number | null; children: ReactNode }) {
  const [tick, setTick] = useState(Date.now)

  useEffect(() => {
    if (fixed !== null) return
    setTick(Date.now())
    const id = window.setInterval(() => setTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [fixed])

  return <ClockContext.Provider value={fixed ?? tick}>{children}</ClockContext.Provider>
}

function Elapsed({ row }: { row: AgentRow }) {
  const now = useContext(ClockContext)
  // `idle` has not started, so there is nothing to time.
  return (
    <span className="w-agents-elapsed">
      {formatElapsed(row.status === 'idle' ? null : row.since, now)}
    </span>
  )
}

/** Local HH:MM:SS. */
function clockTime(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 8)
}
