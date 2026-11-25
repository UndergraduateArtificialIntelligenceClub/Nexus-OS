import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Button, Label, MediaStates, Micro, ScrollArea, Switch, ToolCard, WidgetTemplate } from '@/ui'
import type { AppProps } from '@/apps/types'
import type { Size } from '@/wm/layout'
import type { EngineTool, ToolPolicy } from '@/types/agentEvents'
import { createEngineClient } from '@/shell/agent/engineClient'
import { createFixtureSource, engineSource, withFallback, type FallbackSource, type SourceMode, type ToolsSource } from './source'
import './tools.css'

// Tools manager (issue #30): every tool the agent can call, what it can touch,
// how policy gates it, when it last ran, and a tighten-only "require approval"
// toggle. Live from the engine (GET/PATCH /api/v1/tools) when it answers,
// otherwise the offline fixture — and the widget says which.

// One client for the widget until the shell shares one (#41). listTools /
// setToolApproval are plain fetch; no socket is opened.
let defaultSource: FallbackSource | null = null
const getDefaultSource = () =>
  (defaultSource ??= withFallback(engineSource(createEngineClient()), createFixtureSource()))

export function ToolsApp({ size }: AppProps) {
  return <ToolsManager size={size} source={getDefaultSource()} />
}

export const POLICY_TEXT: Record<ToolPolicy, string> = {
  auto_approve: 'auto-approve',
  approval_required: 'needs approval',
  denied: 'denied',
}

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; tools: EngineTool[] }

interface ToolsManagerProps {
  size: Size
  source: ToolsSource | FallbackSource
  /** For tests: the clock used for "last used". */
  now?: () => number
}

export function ToolsManager({ size, source, now = Date.now }: ToolsManagerProps) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [mode, setMode] = useState<SourceMode | null>(null)
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    setLoad({ state: 'loading' })
    setNotice(null)
    try {
      const tools = await source.list()
      if (!alive.current) return
      setLoad({ state: 'ready', tools })
      setMode('mode' in source ? source.mode : null)
    } catch (e) {
      if (!alive.current) return
      setLoad({ state: 'error', message: e instanceof Error ? e.message : "couldn't load the tools." })
    }
  }, [source])

  useEffect(() => {
    alive.current = true
    void refresh()
    return () => {
      alive.current = false
    }
  }, [refresh])

  const replace = (tool: EngineTool) =>
    setLoad((prev) =>
      prev.state === 'ready' ? { state: 'ready', tools: prev.tools.map((t) => (t.tool_id === tool.tool_id ? tool : t)) } : prev,
    )

  const toggle = async (tool: EngineTool, on: boolean) => {
    setNotice(null)
    setPending((p) => new Set(p).add(tool.tool_id))
    // Optimistic: locked tools never reach here, so off means auto-approve again.
    replace({ ...tool, require_approval: on, policy: on ? 'approval_required' : 'auto_approve' })
    try {
      const updated = await source.setRequireApproval(tool.tool_id, on)
      if (alive.current) replace(updated)
    } catch (e) {
      if (!alive.current) return
      replace(tool)
      setNotice(`couldn't update ${tool.tool_id}: ${e instanceof Error ? e.message : 'the source failed.'}`)
    } finally {
      if (alive.current)
        setPending((p) => {
          const next = new Set(p)
          next.delete(tool.tool_id)
          return next
        })
    }
  }

  const head = (
    <div className="w-tools-head">
      <Label>tools</Label>
      {mode === 'offline' && <Badge title="the engine did not answer; showing the built-in tool list">offline · fixture</Badge>}
      {mode === 'live' && <Badge tone="accent">live</Badge>}
      <Button className="w-tools-refresh" onClick={() => void refresh()} disabled={load.state === 'loading'}>
        refresh
      </Button>
    </div>
  )

  if (load.state !== 'ready') {
    return (
      <div className="w-tools">
        {head}
        {load.state === 'loading' ? (
          <MediaStates state="loading" />
        ) : (
          <MediaStates state="error" message={load.message} onRetry={() => void refresh()} />
        )}
      </div>
    )
  }

  const { tools } = load
  if (tools.length === 0) {
    return (
      <div className="w-tools">
        {head}
        <MediaStates state="empty" emptyHint="the engine has no tools registered" />
      </div>
    )
  }

  const list = (wide: boolean) => (
    <ScrollArea label="agent tools" className="w-tools-scroll">
      <ul className="w-tools-list" data-wide={wide || undefined}>
        {tools.map((tool) => (
          <ToolRow
            key={tool.tool_id}
            tool={tool}
            wide={wide}
            busy={pending.has(tool.tool_id)}
            lastUsed={ago(tool.last_used_at, now())}
            onToggle={(on) => void toggle(tool, on)}
          />
        ))}
      </ul>
    </ScrollArea>
  )

  return (
    <div className="w-tools">
      {head}
      {notice && (
        <p className="w-tools-note" role="alert">
          {notice}
        </p>
      )}
      <WidgetTemplate
        size={size}
        className="w-tools-body"
        content={{ '2x1': <Summary tools={tools} now={now()} />, '2x2': list(false), '4x2': list(true) }}
        fallback={list(false)}
      />
    </div>
  )
}

function ToolRow({
  tool,
  wide,
  busy,
  lastUsed,
  onToggle,
}: {
  tool: EngineTool
  wide: boolean
  busy: boolean
  lastUsed: string
  onToggle: (on: boolean) => void
}) {
  const hint = lockHint(tool)
  return (
    <li className="w-tools-row" data-tool={tool.tool_id} data-policy={tool.policy} title={hint ?? undefined}>
      <ToolCard
        name={tool.tool_id}
        args={wide ? tool.description : undefined}
        meta={
          <>
            <Badge className="w-tools-scope">{tool.scope}</Badge>
            <Badge className="w-tools-policy" tone={tool.policy === 'auto_approve' ? 'default' : 'accent'}>
              {POLICY_TEXT[tool.policy]}
            </Badge>
            <Micro className="w-tools-used">{lastUsed}</Micro>
          </>
        }
        actions={
          tool.policy === 'denied' ? (
            <Micro className="w-tools-blocked">blocked</Micro>
          ) : (
            <Switch
              className="w-tools-switch"
              label={`require approval for ${tool.tool_id}`}
              checked={tool.policy === 'approval_required'}
              disabled={tool.policy_locked || busy}
              onChange={onToggle}
            />
          )
        }
      />
      {hint && wide && <Micro className="w-tools-hint">{hint}</Micro>}
    </li>
  )
}

function Summary({ tools, now }: { tools: EngineTool[]; now: number }) {
  const count = (pick: (t: EngineTool) => boolean) => tools.filter(pick).length
  const latest = tools
    .filter((t) => t.last_used_at)
    .sort((a, b) => Date.parse(b.last_used_at!) - Date.parse(a.last_used_at!))[0]
  return (
    <div className="w-tools-summary">
      <p className="w-tools-big">
        {tools.length} tools · {count((t) => t.policy === 'approval_required')} need approval
      </p>
      <Micro as="p">
        {count((t) => t.policy === 'auto_approve')} auto-approve · {count((t) => t.policy === 'denied')} denied
      </Micro>
      <Micro as="p">
        read {count((t) => t.scope === 'read')} · mutate {count((t) => t.scope === 'mutate')} · network{' '}
        {count((t) => t.scope === 'network')}
      </Micro>
      <Micro as="p">{latest ? `last: ${latest.tool_id} ${ago(latest.last_used_at, now)}` : 'no tool has run yet'}</Micro>
    </div>
  )
}

/** Why the toggle can't move, or null when it can. */
export function lockHint(tool: EngineTool): string | null {
  if (tool.policy === 'denied') return 'switched off in the engine registry'
  if (!tool.policy_locked) return null
  if (tool.scope === 'network') return 'network tools always ask first'
  return 'tools that change things always ask first'
}

/** "4m ago" style; "never used" for tools that never ran. */
export function ago(iso: string | null, now: number): string {
  if (!iso) return 'never used'
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (Number.isNaN(seconds)) return 'unknown'
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
