import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createRosterSource, fixtureRoster, liveRoster } from './roster'
import { AgentsManager } from './App'

const props = { instanceId: 'agents-test', mode: 'widget' as const }
const now = 1_000_000

function renderRoster(size: '2x1' | '2x2' | '4x2' = '2x2') {
  const source = createRosterSource('fixture', fixtureRoster(now))
  return render(<AgentsManager {...props} size={size} source={source} now={now} />)
}

describe('AgentsManager', () => {
  it('renders the fixture roster and identifies it as fixture data', () => {
    renderRoster()

    expect(screen.getByTestId('agents-source')).toHaveTextContent('fixture')
    expect(screen.getByTestId('agents-summary')).toHaveTextContent('4 agents · 1 working · 1 waiting · 1 error')
    expect(screen.getAllByText('research-web').length).toBeGreaterThan(0)
    expect(screen.getAllByText('agent.research').length).toBeGreaterThan(0)
    expect(screen.getAllByText('drafting the summary').length).toBeGreaterThan(0)
  })

  it('changes the selected detail without providing a control verb or chat input', async () => {
    const user = userEvent.setup()
    renderRoster('2x2')

    await user.click(screen.getByRole('button', { name: /file-indexer/i }))
    expect(screen.getByTestId('agents-detail')).toHaveAttribute('data-agent-id', 'agent.index')
    expect(screen.getByText('confirm 12 files')).toBeInTheDocument()
    expect(screen.getByText(/read-only preview/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pause|resume|cancel|retry/i })).not.toBeInTheDocument()
  })

  it('keeps the detail pane out of compact 2x1', () => {
    renderRoster('2x1')
    expect(screen.queryByTestId('agents-detail')).not.toBeInTheDocument()
  })

  it('reacts when a live source receives an engine event', () => {
    const source = createRosterSource('live', liveRoster(now))
    render(<AgentsManager {...props} size="2x2" source={source} now={now} />)

    expect(screen.getByTestId('agents-source')).toHaveTextContent('live')
    act(() => {
      source.apply({
        type: 'agent.state',
        session_id: 'session',
        run_id: 'run',
        ts: '2026-11-21T00:00:00.000Z',
        data: { state: 'thinking' },
      })
    })
    expect(screen.getAllByText('thinking it through').length).toBeGreaterThan(0)
  })

  it('renders an honest empty state', () => {
    const source = createRosterSource('fixture', [])
    render(<AgentsManager {...props} size="2x2" source={source} now={now} />)
    expect(screen.getByText('no agents on the roster')).toBeInTheDocument()
  })
})
