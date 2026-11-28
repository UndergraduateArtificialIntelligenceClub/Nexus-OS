import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { APPS } from '@/apps/registry'
import { SIZE_ORDER } from '@/wm/layout'
import { fixtureAgents, fixtureRosterSource, liveRosterSource } from './roster'
import { AgentsManager, AgentsManagerApp } from './App'
import { T0, agent, fakeFeed, runView, updated } from './testFeed'

const props = { instanceId: 'agents-test', mode: 'widget' as const }
const now = Date.parse(T0)

function renderFixture(size: '2x1' | '2x2' | '4x2' = '2x2') {
  const source = fixtureRosterSource(fixtureAgents(now))
  return render(<AgentsManager {...props} size={size} source={source} now={now} />)
}

const row = (id: string) => document.querySelector<HTMLElement>(`.w-agents-row[data-agent-id="${id}"]`)!
const status = (id: string) => row(id).querySelector('.w-agents-state')!
/** The roster item (row button + its verb line) for one agent. */
const item = (id: string) => document.querySelector<HTMLElement>(`li[data-agent-id="${id}"]`)!
const verbs = (id: string) =>
  [...item(id).querySelectorAll('.w-agents-verb')].map((el) => (el as HTMLElement).dataset.verb)

async function renderLive(agents = [agent('supervisor:run-1', {
  role: 'supervisor',
  label: 'supervisor',
  last_activity: 'open the browser',
})]) {
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
    expect(screen.getByTestId('agents-summary')).toHaveTextContent('14 agents · 2 running · 4 waiting · 1 paused · 2 error')

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
    expect(ids.slice(0, 6)).toEqual([
      'supervisor:run-tidy',
      'task:req-tidy:direct',
      'supervisor:run-report',
      'task:req-report:report',
      'supervisor:run-digest',
      'task:req-digest:purge',
    ])
    expect(row('supervisor:run-research')).toHaveAttribute('data-kind', 'supervisor')
    expect(row('task:req-research:read')).toHaveAttribute('data-kind', 'task')
  })

  it('moves the detail pane to the selected agent', async () => {
    const user = userEvent.setup()
    renderFixture('2x2')

    // The newest run's supervisor is selected by default.
    expect(screen.getByTestId('agents-detail')).toHaveAttribute('data-agent-id', 'supervisor:run-tidy')
    await user.click(row('task:req-sync:fetch'))
    const detail = screen.getByTestId('agents-detail')
    expect(detail).toHaveAttribute('data-agent-id', 'task:req-sync:fetch')
    expect(within(detail).getByText('run-sync')).toBeInTheDocument()
    expect(within(detail).getByText('source unreachable')).toBeInTheDocument()
    expect(within(detail).getByText(/verbs do only what the engine can perform/)).toBeInTheDocument()
  })

  it('keeps the detail pane out of compact 2x1', () => {
    renderFixture('2x1')
    expect(screen.queryByTestId('agents-detail')).not.toBeInTheDocument()
  })

  // Review checklist (concepts.md §5): not a chat surface, not engine
  // settings, and the verbs stay honest - one row, its own verbs, nothing else.
  it('is not a chat surface, a settings page, or a pop-up factory', () => {
    renderFixture('4x2')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    // The interrupt only appears through a row's `open` verb, never on its own.
    expect(screen.queryByTestId('agents-interrupt')).not.toBeInTheDocument()
  })

  it('shows only the verbs each row can honestly perform, enabled by the fixture engine', () => {
    renderFixture('4x2')

    expect(verbs('supervisor:run-digest')).toEqual(['resume', 'cancel'])
    expect(verbs('task:req-digest:purge')).toEqual(['run_now'])
    expect(verbs('supervisor:run-report')).toEqual(['open', 'cancel'])
    // A finished run has nothing left to do.
    expect(verbs('supervisor:run-tidy')).toEqual([])
    expect(verbs('supervisor:run-research')).toEqual(['pause', 'cancel'])
    expect(verbs('supervisor:run-open')).toEqual(['open', 'cancel'])
    expect(verbs('task:req-open:direct')).toEqual(['open', 'cancel'])
    expect(verbs('task:req-sync:fetch')).toEqual(['retry', 'cancel'])
    expect(verbs('task:req-research:save')).toEqual(['run_now'])
    expect(verbs('task:req-research:read')).toEqual(['cancel'])
    // A done row has nothing left to do.
    expect(verbs('task:req-research:search')).toEqual([])

    // The fixture's simulated engine performs them: every offered verb is live.
    for (const button of screen.getAllByRole('button', { name: /^(pause|resume|cancel|retry|run now|open)$/ })) {
      expect(button).toBeEnabled()
    }

    // Waiting rows say what they wait for (#58).
    expect(within(item('task:req-open:direct')).getByText('needs a decision')).toBeInTheDocument()
    expect(within(item('supervisor:run-open')).getByText('needs a decision')).toBeInTheDocument()
  })

  it('drives its dummy rows through the verbs: optimistic, then confirmed', async () => {
    const user = userEvent.setup()
    renderFixture('2x2')

    await user.click(within(item('supervisor:run-research')).getByRole('button', { name: 'pause' }))
    // Optimistic first: the row flips before the fixture engine answers.
    expect(status('supervisor:run-research')).toHaveTextContent(/ paused$/)
    // Then the confirm lands with its reason - and the run's in-flight task
    // completes before the halt, exactly like the engine's pause semantics.
    await waitFor(() => expect(within(item('supervisor:run-research')).getByText('paused by the user')).toBeInTheDocument())
    expect(status('supervisor:run-research')).toHaveTextContent(/ paused$/)
    await waitFor(() => expect(within(item('task:req-research:read')).getByText('completed before the pause')).toBeInTheDocument())
    expect(status('task:req-research:save')).toHaveTextContent(/ idle$/)

    // Resume continues the run: the planned task is dispatched, the run finishes.
    await user.click(within(item('supervisor:run-research')).getByRole('button', { name: 'resume' }))
    await waitFor(() => expect(within(item('supervisor:run-research')).getByText('completed the run')).toBeInTheDocument(), { timeout: 4000 })
    expect(within(item('task:req-research:save')).getByText('completed after the resume')).toBeInTheDocument()
  })

  it('stops one task pass from its own row without closing the run', async () => {
    const user = userEvent.setup()
    renderFixture('2x2')

    await user.click(within(item('task:req-research:read')).getByRole('button', { name: 'cancel' }))
    await waitFor(() => expect(within(item('task:req-research:read')).getByText('cancelled')).toBeInTheDocument())
    expect(status('task:req-research:read')).toHaveTextContent(/ done$/)
    // The supervisor and the run's other tasks are untouched (#57: a task's
    // cancel stops its pass, not the whole crew).
    expect(status('supervisor:run-research')).toHaveTextContent(/ running$/)
    expect(status('task:req-research:save')).toHaveTextContent(/ idle$/)
  })

  it("approving a dummy run's interrupt continues the run (#58)", async () => {
    const user = userEvent.setup()
    renderFixture('2x2')

    await user.click(within(item('supervisor:run-open')).getByRole('button', { name: 'open' }))
    const panel = await screen.findByTestId('agents-interrupt')
    expect(within(panel).getByText(/Allow open_application/)).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: 'yes' }))
    // The row transitions back to running, then the run completes.
    await waitFor(() => expect(status('supervisor:run-open')).toHaveTextContent(/ running$/))
    await waitFor(() => expect(within(item('supervisor:run-open')).getByText('completed the approved work')).toBeInTheDocument(), { timeout: 4000 })
    expect(status('task:req-open:direct')).toHaveTextContent(/ done$/)
  })

  it("opens a dummy run's interrupt and denies it into a clean failure", async () => {
    const user = userEvent.setup()
    renderFixture('2x2')

    await user.click(within(item('supervisor:run-open')).getByRole('button', { name: 'open' }))
    const panel = await screen.findByTestId('agents-interrupt')
    expect(within(panel).getByText(/Allow open_application/)).toBeInTheDocument()
    // The panel renders on the row that opened it, never over the roster.
    expect(item('supervisor:run-open').querySelector('[data-testid=agents-interrupt]')).not.toBeNull()
    expect(item('supervisor:run-report').querySelector('[data-testid=agents-interrupt]')).toBeNull()

    await user.click(within(panel).getByRole('button', { name: 'no' }))
    await waitFor(() => expect(status('supervisor:run-open')).toHaveTextContent(/ error$/))
    expect(within(item('supervisor:run-open')).getByText('user rejected the action')).toBeInTheDocument()
    expect(status('task:req-open:direct')).toHaveTextContent(/ error$/)
    // One decision, one run: the other waiting crew is untouched.
    expect(status('supervisor:run-report')).toHaveTextContent(/ waiting$/)
    expect(status('task:req-report:report')).toHaveTextContent(/ waiting$/)
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

  // --- Verbs (#57): optimistic, engine-confirmed, rolled back on rejection ---

  it('performs a verb optimistically and keeps it when the engine confirms', async () => {
    const user = userEvent.setup()
    const harness = await renderLive()
    const pause = within(item('supervisor:run-1')).getByRole('button', { name: 'pause' })
    expect(pause).toBeEnabled()

    await user.click(pause)
    expect(harness.feed.command).toHaveBeenCalledWith('supervisor:run-1', 'pause')
    // Optimistic first: the row shows paused before the engine has said so.
    expect(status('supervisor:run-1')).toHaveTextContent(/ paused$/)

    // The engine confirms; its word replaces the optimistic one.
    act(() => {
      harness.emit(updated(agent('supervisor:run-1', {
        role: 'supervisor',
        label: 'supervisor',
        status: 'paused',
        since: '2026-11-23T10:00:04Z',
        updated_at: '2026-11-23T10:00:04Z',
        last_activity: 'paused by the user',
      })))
    })
    expect(status('supervisor:run-1')).toHaveTextContent(/ paused$/)
    // A paused supervisor can resume; its verbs are live again.
    expect(within(item('supervisor:run-1')).getByRole('button', { name: 'resume' })).toBeEnabled()
  })

  it('rolls a verb back when the engine rejects it', async () => {
    const user = userEvent.setup()
    const harness = await renderLive()
    // The rejection stays in flight until the test fires it, so the
    // optimistic patch is observable before the rollback.
    let rejectCommand!: (error: unknown) => void
    vi.mocked(harness.feed.command).mockImplementationOnce(
      () => new Promise((_, reject) => { rejectCommand = reject }),
    )

    await user.click(within(item('supervisor:run-1')).getByRole('button', { name: 'pause' }))
    expect(harness.feed.command).toHaveBeenCalledWith('supervisor:run-1', 'pause')
    expect(status('supervisor:run-1')).toHaveTextContent(/ paused$/)

    // Rejection: the row returns to the engine's last word, usable again.
    act(() => rejectCommand(new Error('409: run is not running')))
    await waitFor(() => expect(status('supervisor:run-1')).toHaveTextContent(/ running$/))
    expect(within(item('supervisor:run-1')).getByRole('button', { name: 'pause' })).toBeEnabled()
  })

  it('disables every verb while the engine is offline', async () => {
    const harness = await renderLive()
    expect(within(item('supervisor:run-1')).getByRole('button', { name: 'pause' })).toBeEnabled()

    act(() => harness.connect(false))
    expect(within(item('supervisor:run-1')).getByRole('button', { name: 'pause' })).toBeDisabled()
    expect(within(item('supervisor:run-1')).getByRole('button', { name: 'cancel' })).toBeDisabled()
  })

  // --- Interrupts (#58): waiting rows route into InterruptPanel ---

  it("routes a waiting row into the InterruptPanel and resolves through the run's resume", async () => {
    const user = userEvent.setup()
    const harness = await renderLive([agent('supervisor:run-1', {
      role: 'supervisor',
      label: 'supervisor',
      status: 'waiting',
      last_activity: 'Allow open_application (reversible_write) targeting app:browser',
    })])

    await user.click(within(item('supervisor:run-1')).getByRole('button', { name: 'open' }))
    expect(harness.feed.getRun).toHaveBeenCalledWith('run-1')

    const panel = await screen.findByTestId('agents-interrupt')
    expect(panel).toHaveAttribute('data-run-id', 'run-1')
    expect(within(panel).getByText('Allow open_application (reversible_write) targeting app:browser')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'yes' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'no' })).toBeInTheDocument()

    // Approve: the engine continues; the row's transition arrives as agent.updated.
    await user.click(within(panel).getByRole('button', { name: 'yes' }))
    expect(harness.feed.resume).toHaveBeenCalledWith('run-1', 'yes')
    expect(screen.queryByTestId('agents-interrupt')).not.toBeInTheDocument()

    act(() => {
      harness.emit(updated(agent('supervisor:run-1', {
        role: 'supervisor',
        label: 'supervisor',
        status: 'running',
        since: '2026-11-23T10:00:04Z',
        updated_at: '2026-11-23T10:00:04Z',
        last_activity: 'user approved the action',
      })))
    })
    expect(status('supervisor:run-1')).toHaveTextContent(/ running$/)
  })

  it('closes the panel when the engine says there is nothing to answer', async () => {
    const user = userEvent.setup()
    const harness = await renderLive([agent('supervisor:run-1', {
      role: 'supervisor',
      label: 'supervisor',
      status: 'waiting',
      last_activity: 'Allow open_application',
    })])
    vi.mocked(harness.feed.getRun).mockResolvedValueOnce(runView({ status: 'running', interrupt: null }))

    await user.click(within(item('supervisor:run-1')).getByRole('button', { name: 'open' }))
    // A null answer used to leave the panel on "asking…" forever.
    await waitFor(() => expect(screen.queryByText(/asking the engine/)).not.toBeInTheDocument())
    expect(screen.queryByTestId('agents-interrupt')).not.toBeInTheDocument()
  })

  it('shows the deny outcome on the row: a clean failure, not a re-ask', async () => {
    const user = userEvent.setup()
    const harness = await renderLive([agent('supervisor:run-1', {
      role: 'supervisor',
      label: 'supervisor',
      status: 'waiting',
      last_activity: 'Allow open_application (reversible_write) targeting app:browser',
    })])

    await user.click(within(item('supervisor:run-1')).getByRole('button', { name: 'open' }))
    const panel = await screen.findByTestId('agents-interrupt')

    await user.click(within(panel).getByRole('button', { name: 'no' }))
    expect(harness.feed.resume).toHaveBeenCalledWith('run-1', 'no')
    expect(screen.queryByTestId('agents-interrupt')).not.toBeInTheDocument()

    // Deny is a clean failure (#58): the row ends in its error state.
    act(() => {
      harness.emit(updated(agent('supervisor:run-1', {
        role: 'supervisor',
        label: 'supervisor',
        status: 'error',
        since: '2026-11-23T10:00:04Z',
        updated_at: '2026-11-23T10:00:04Z',
        last_activity: 'user rejected the action',
      })))
    })
    expect(status('supervisor:run-1')).toHaveTextContent(/ error$/)
  })
})
