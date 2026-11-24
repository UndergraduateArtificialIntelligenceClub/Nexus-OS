import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { AppProps } from '@/apps/types'
import type { AgentStateName, AgentStatus as EngineStatus } from '@/types/agentEvents'
import { AgentStatus, Badge, EmptyState, Label, Mono } from '@/ui'
import {
  defaultRosterSource,
  formatElapsed,
  orderRows,
  rosterSummary,
  type AgentRow,
  type RosterSource,
} from './roster'
import './agents-manager.css'

// The agents manager: a read-only duty roster. One row per engine agent -
// [status] label · elapsed · activity - grouped by run. It is not a chat
// surface (the orb owns conversation), not an engine settings page, and not an
// approval prompt (concepts.md §5). It shows no control verb until the engine
// can perform it (#57). The shell draws the frame; this renders content.

/** The avatar's glyph for each roster status; the word is always the roster's own. */
const GLYPH_STATE: Record<EngineStatus, AgentStateName> = {
  idle: 'idle',
  running: 'acting',
  waiting: 'waiting',
  done: 'idle',
  error: 'error',
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
                  selected={row.id === selected?.id}
                  frozen={frozen}
                  onSelect={setSelectedId}
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
  selected: boolean
  frozen: boolean
  onSelect: (id: string) => void
}

/** Memoized: an `agent.updated` re-renders its own row only; time ticks re-render only `Elapsed`. */
const RosterRow = memo(function RosterRow({ row, selected, frozen, onSelect }: RosterRowProps) {
  return (
    <li>
      <button
        type="button"
        className="w-agents-row"
        data-status={row.status}
        data-kind={row.role === 'supervisor' ? 'supervisor' : 'task'}
        data-agent-id={row.id}
        aria-current={selected ? 'true' : undefined}
        title={`${row.label} · ${row.id}`}
        onClick={() => onSelect(row.id)}
      >
        <RosterStatus status={row.status} frozen={frozen} />
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

      <p className="w-agents-note">read-only · controls arrive once the engine can perform them</p>
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
