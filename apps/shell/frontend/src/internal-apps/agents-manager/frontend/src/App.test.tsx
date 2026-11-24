import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { APPS } from '@/apps/registry'
import { SIZE_ORDER } from '@/wm/layout'
import { fixtureAgents, fixtureRosterSource, liveRosterSource } from './roster'
import { AgentsManager, AgentsManagerApp } from './App'
import { T0, agent, fakeFeed, updated } from './testFeed'

const props = { instanceId: 'agents-test', mode: 'widget' as const }
const now = Date.parse(T0)

function renderFixture(size: '2x1' | '2x2' | '4x2' = '2x2') {
  const source = fixtureRosterSource(fixtureAgents(now))
  return render(<AgentsManager {...props} size={size} source={source} now={now} />)
}

const row = (id: string) => document.querySelector<HTMLElement>(`.w-agents-row[data-agent-id="${id}"]`)!
const status = (id: string) => row(id).querySelector('.w-agents-state')!

async function renderLive(agents = [agent('supervisor:run-1', { last_activity: 'open the browser' })]) {
  const harness = fakeFeed()
  const source = liveRosterSource(harness.feed, () => now + 30_000)
  render(<AgentsManager {...props} size="2x2" source={source} now={now + 10_000} />)
  await act(async () => {
    harness.connect(true)
    harness.lists[0].resolve(agents)
  })
  return harness
}

describe('AgentsManager', () => {
  it('is registered on the grid with the sizes it lays out', () => {
    const def = APPS.agents
    expect(def.component).toBe(AgentsManagerApp)
    expect(def.sizes).toEqual(['2x1', '2x2', '4x2'])
    expect(def.sizes).toContain(def.defaultSize)
    for (const size of def.sizes) expect(SIZE_ORDER).toContain(size)
  })

  it('renders each agent with the row anatomy: status, label, elapsed, activity, role', () => {
    renderFixture()

    expect(screen.getByTestId('agents-source')).toHaveTextContent('fixture')
    expect(screen.getByTestId('agents-summary')).toHaveTextContent('8 agents · 2 running · 2 waiting · 2 error')

    const waiting = row('task:req-open:direct')
    expect(status('task:req-open:direct')).toHaveTextContent(/ waiting$/)
    expect(within(waiting).getByText('Open application browser')).toBeInTheDocument()
    expect(within(waiting).getByText('40s')).toBeInTheDocument()
    expect(within(waiting).getByText(/Allow open_application/)).toBeInTheDocument()
    expect(within(waiting).getByText('recipe')).toBeInTheDocument()

    expect(within(row('task:req-research:save')).getByText('—')).toBeInTheDocument()
    expect(within(row('supervisor:run-research')).getByText('2m14s')).toBeInTheDocument()
    // A supervisor's label already is its role.
    expect(row('supervisor:run-research').querySelector('.w-agents-role')).toBeNull()
  })

  it('groups task agents under their run, newest run first', () => {
    renderFixture()
    const ids = [...document.querySelectorAll('.w-agents-row')].map((el) => el.getAttribute('data-agent-id'))
    expect(ids.slice(0, 4)).toEqual([
      'supervisor:run-research',
      'task:req-research:search',
      'task:req-research:read',
      'task:req-research:save',
    ])
    expect(row('supervisor:run-research')).toHaveAttribute('data-kind', 'supervisor')
    expect(row('task:req-research:read')).toHaveAttribute('data-kind', 'task')
  })

  it('moves the detail pane to the selected agent', async () => {
    const user = userEvent.setup()
    renderFixture('2x2')

    expect(screen.getByTestId('agents-detail')).toHaveAttribute('data-agent-id', 'supervisor:run-research')
    await user.click(row('task:req-sync:fetch'))
    const detail = screen.getByTestId('agents-detail')
    expect(detail).toHaveAttribute('data-agent-id', 'task:req-sync:fetch')
    expect(within(detail).getByText('run-sync')).toBeInTheDocument()
    expect(within(detail).getByText('source unreachable')).toBeInTheDocument()
    expect(within(detail).getByText(/read-only/)).toBeInTheDocument()
  })

  it('keeps the detail pane out of compact 2x1', () => {
    renderFixture('2x1')
    expect(screen.queryByTestId('agents-detail')).not.toBeInTheDocument()
  })

  // Review checklist (concepts.md §5): not a chat surface, not engine settings,
  // not a permission pop-up factory, and no verb the engine cannot perform.
  it('is not a chat surface, a settings page, or an approval prompt', () => {
    renderFixture('4x2')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    for (const button of screen.getAllByRole('button')) expect(button).toHaveClass('w-agents-row')
    expect(screen.queryByRole('button', { name: /^(pause|resume|cancel|retry|approve|reject|allow|deny)$/i })).toBeNull()
  })

  it('renders live rows from the catch-up list and updates them from agent.updated', async () => {
    const harness = await renderLive()

    expect(screen.getByTestId('agents-source')).toHaveTextContent('live')
    expect(within(row('supervisor:run-1')).getByText('open the browser')).toBeInTheDocument()

    act(() => {
      harness.emit(updated(agent('supervisor:run-1', {
        status: 'waiting',
        since: '2026-11-23T10:00:04Z',
        updated_at: '2026-11-23T10:00:04Z',
        last_activity: 'Allow open_application',
      })))
    })
    expect(status('supervisor:run-1')).toHaveTextContent(/ waiting$/)
    expect(within(row('supervisor:run-1')).getByText('Allow open_application')).toBeInTheDocument()
    expect(within(row('supervisor:run-1')).getByText('6s')).toBeInTheDocument()
  })

  it('freezes the last known rows behind a banner when the engine drops, never showing fixtures', async () => {
    const harness = await renderLive()
    expect(row('supervisor:run-1').querySelector('.ascii-spinner')).not.toBeNull()
    act(() => harness.connect(false))

    expect(screen.getByTestId('agents-source')).toHaveTextContent('offline')
    expect(screen.getByTestId('agents-offline')).toHaveTextContent(/engine offline · last known roster from \d\d:\d\d:\d\d/)
    // Elapsed stops at the moment the engine went away (now + 30s), not the widget clock.
    expect(within(row('supervisor:run-1')).getByText('30s')).toBeInTheDocument()
    expect(row('supervisor:run-1').querySelector('.ascii-spinner')).toBeNull()
    expect(status('supervisor:run-1')).toHaveTextContent('· running')
    expect(screen.queryByText('Open application browser')).toBeNull()
  })

  it('says it is retrying, with no rows, when the engine was never reached', async () => {
    const harness = fakeFeed()
    render(<AgentsManager {...props} size="2x2" source={liveRosterSource(harness.feed)} now={now} />)
    expect(screen.getByText('connecting to the engine')).toBeInTheDocument()

    act(() => harness.connect(false))
    expect(screen.getByTestId('agents-offline')).toHaveTextContent('engine offline · retrying')
    expect(screen.getByText('no agents on the roster')).toBeInTheDocument()
  })

  it('closes its engine feed when the widget unmounts', () => {
    const harness = fakeFeed()
    const { unmount } = render(<AgentsManager {...props} size="2x2" source={liveRosterSource(harness.feed)} now={now} />)
    unmount()
    expect(harness.close).toHaveBeenCalledTimes(1)
  })
})
