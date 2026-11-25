import type { ReactNode } from 'react'
import { Badge } from '../components/Markers'
import { Mono } from '../components/Text'
import type { TaskStatus } from '@/types/agentEvents'

// One tool, one card: name, arguments summary, status glyph, ack state.
// The glyph carries the state; color never has to.
// Without `status` it is a catalogue row (Tools manager): `meta` holds badges
// after the name, `actions` holds a control pinned to the right.

export interface ToolCardProps {
  name: string
  /** Short args summary, e.g. `("notes", "2x1")`. */
  args?: string
  /** Run state of one tool call. Omit for a catalogue row (no glyph). */
  status?: TaskStatus
  /** The engine acknowledged the ui.command this tool produced. */
  ack?: 'pending' | 'ok' | 'failed'
  /** Badges / short facts shown after the name. */
  meta?: ReactNode
  /** A control (e.g. a Switch) pinned to the right edge. */
  actions?: ReactNode
  className?: string
}

export function ToolCard({ name, args, status, ack, meta, actions, className }: ToolCardProps) {
  return (
    <div className={className ?? 'nx-toolcard'} data-status={status}>
      {status && (
        <span className="nx-toolcard-glyph" aria-hidden="true">
          {GLYPH[status]}
        </span>
      )}
      <Mono className="nx-toolcard-name">
        {name}
        {args ? <span className="nx-toolcard-args">{args}</span> : null}
      </Mono>
      {meta ? <span className="nx-toolcard-meta">{meta}</span> : null}
      {ack && (
        <Badge tone={ack === 'ok' ? 'default' : 'default'} className="nx-toolcard-ack">
          {ack === 'pending' ? '…sent' : ack === 'ok' ? 'ack' : 'no ack'}
        </Badge>
      )}
      {actions ? <span className="nx-toolcard-actions">{actions}</span> : null}
    </div>
  )
}

const GLYPH: Record<TaskStatus, string> = {
  queued: '·',
  running: '>',
  done: '=',
  failed: 'x',
  skipped: '-',
}
