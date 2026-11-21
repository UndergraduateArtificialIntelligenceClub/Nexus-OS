import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AppProps } from '@/apps/types'
import type { AgentStateName } from '@/types/agentEvents'
import {
  ActivityTimeline,
  AgentStatus,
  Badge,
  EmptyState,
  Label,
  Mono,
} from '@/ui'
import {
  defaultRosterSource,
  formatElapsed,
  rosterSummary,
  type AgentRow,
  type RosterSource,
} from './roster'
import './agents-manager.css'

// The agents manager: a read-only duty roster. It shows what each agent is
// doing, for how long, and what it needs — never a chat box, never a control the
// engine cannot perform. The shell's frame is automatic; this renders content.

/** Roster rows use nouns, not the orb's conversational replies. */
const ROSTER_STATUS: Partial<Record<AgentStateName, string>> = {
  idle: 'idle',
  error: 'error',
}

export function AgentsManagerApp(props: AppProps) {
  const [source] = useState(() => defaultRosterSource())
  return <AgentsManager {...props} source={source} />
}

export interface AgentsManagerProps extends AppProps {
  source: RosterSource
  /** Fixed clock for tests; the widget ticks once a second when omitted. */
  now?: number
}

export function AgentsManager({ size, mode, source, now: fixedNow }: AgentsManagerProps) {
  const rows = useSyncExternalStore(source.subscribe, source.rows)
  const now = useNow(fixedNow)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null
  const split = mode === 'fullscreen' || size === '2x2' || size === '4x2'

  return (
    <div
      className="w-agents"
      data-size={size}
      data-layout={split ? 'split' : 'compact'}
      data-source={source.kind}
    >
      <header className="w-agents-head">
        <div className="w-agents-heading">
          <Label>agents</Label>
          <Badge
            tone={source.kind === 'live' ? 'accent' : 'default'}
            data-testid="agents-source"
          >
            {source.kind}
          </Badge>
        </div>
        <Mono as="span" className="w-agents-summary" data-testid="agents-summary">
          {rows.length} {rows.length === 1 ? 'agent' : 'agents'} · {rosterSummary(rows)}
        </Mono>
      </header>

      {rows.length === 0 ? (
        <EmptyState hint="no agents on the roster" className="w-agents-empty" />
      ) : (
        <div className="w-agents-body">
          <ul className="w-agents-roster" aria-label="Agent roster">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="w-agents-row"
                  data-status={row.status}
                  aria-current={selected?.id === row.id ? 'true' : undefined}
                  title={`${row.label} · ${row.id}`}
                  onClick={() => setSelectedId(row.id)}
                >
                  <AgentStatus
                    status={row.status}
                    labels={ROSTER_STATUS}
                    className="w-agents-state"
                  />
                  <span className="w-agents-label">{row.label}</span>
                  <span className="w-agents-elapsed">{formatElapsed(row.since, now)}</span>
                  <span className="w-agents-activity">{row.activity}</span>
                  <Mono as="span" className="w-agents-id">
                    {row.id}
                  </Mono>
                </button>
              </li>
            ))}
          </ul>

          {split && selected ? <AgentDetail row={selected} now={now} /> : null}
        </div>
      )}
    </div>
  )
}

function AgentDetail({ row, now }: { row: AgentRow; now: number }) {
  return (
    <section
      className="w-agents-detail"
      aria-label={`${row.label} detail`}
      data-testid="agents-detail"
      data-agent-id={row.id}
    >
      <div className="w-agents-detail-head">
        <span className="w-agents-detail-label">{row.label}</span>
        <Mono as="span" className="w-agents-id">
          {row.id}
        </Mono>
      </div>

      <div className="w-agents-detail-status">
        <AgentStatus
          status={row.status}
          labels={ROSTER_STATUS}
          className="w-agents-state"
        />
        <span className="w-agents-elapsed">{formatElapsed(row.since, now)}</span>
      </div>

      <p className="w-agents-detail-activity">{row.activity}</p>

      <div className="w-agents-detail-tasks">
        <Label>activity</Label>
        <ActivityTimeline tasks={row.tasks} />
      </div>

      <p className="w-agents-note">
        read-only preview · controls arrive with the roster contract
      </p>
    </section>
  )
}

function useNow(fixed?: number) {
  const [tick, setTick] = useState(() => Date.now())

  useEffect(() => {
    if (fixed !== undefined) return
    const id = window.setInterval(() => setTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [fixed])

  return fixed ?? tick
}
