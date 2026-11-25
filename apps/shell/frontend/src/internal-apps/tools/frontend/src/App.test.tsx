import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { EngineTool } from '@/types/agentEvents'
import { ago, ToolsManager } from './App'
import { createFixtureSource, STORAGE_KEY, withFallback, type ToolsSource } from './source'

const NOW = Date.parse('2026-11-21T12:00:00Z')
const now = () => NOW
const fixture = () => createFixtureSource({ now })

const row = (toolId: string) => document.querySelector(`[data-tool="${toolId}"]`) as HTMLElement
const switchFor = (toolId: string) => screen.getByRole('switch', { name: `require approval for ${toolId}` })

describe('<ToolsManager> (fixture mode)', () => {
  beforeEach(() => localStorage.clear())

  it('shows a loading state, then every tool with scope, policy and last use', async () => {
    render(<ToolsManager size="2x2" source={fixture()} now={now} />)
    expect(screen.getByRole('status', { name: 'loading' })).toBeInTheDocument()
    expect(await screen.findByText('file_search')).toBeInTheDocument()
    expect(document.querySelectorAll('.w-tools-row')).toHaveLength(9)

    const diag = within(row('system_diagnostics'))
    expect(diag.getByText('read')).toBeInTheDocument()
    expect(diag.getByText('auto-approve')).toBeInTheDocument()
    expect(diag.getByText('4m ago')).toBeInTheDocument()

    const web = within(row('search_web'))
    expect(web.getByText('network')).toBeInTheDocument()
    expect(web.getByText('needs approval')).toBeInTheDocument()
    expect(within(row('memory_save')).getByText('mutate')).toBeInTheDocument()
    expect(within(row('document_read')).getByText('never used')).toBeInTheDocument()
  })

  it('locks the toggle for tools that already require approval', async () => {
    render(<ToolsManager size="2x2" source={fixture()} now={now} />)
    await screen.findByText('search_web')
    for (const id of ['search_web', 'fetch_page', 'memory_save', 'document_create', 'open_application']) {
      expect(switchFor(id)).toBeDisabled()
      expect(switchFor(id)).toHaveAttribute('aria-checked', 'true')
    }
    expect(row('search_web')).toHaveAttribute('title', 'network tools always ask first')
    expect(switchFor('file_search')).toBeEnabled()
    expect(switchFor('file_search')).toHaveAttribute('aria-checked', 'false')
  })

  it('toggling a read tool requires approval and persists it', async () => {
    render(<ToolsManager size="2x2" source={fixture()} now={now} />)
    await screen.findByText('file_search')
    fireEvent.click(switchFor('file_search'))
    expect(switchFor('file_search')).toHaveAttribute('aria-checked', 'true') // optimistic
    await waitFor(() => expect(switchFor('file_search')).toBeEnabled())
    expect(within(row('file_search')).getByText('needs approval')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).overrides).toEqual({ file_search: true })

    fireEvent.click(switchFor('file_search'))
    await waitFor(() => expect(within(row('file_search')).getByText('auto-approve')).toBeInTheDocument())
    await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).overrides).toEqual({}))
  })

  it('rolls back and says so when a toggle fails', async () => {
    const base = fixture()
    const failing: ToolsSource = { list: base.list, setRequireApproval: () => Promise.reject(new Error('engine said no')) }
    render(<ToolsManager size="2x2" source={failing} now={now} />)
    await screen.findByText('file_search')
    fireEvent.click(switchFor('file_search'))
    expect(await screen.findByRole('alert')).toHaveTextContent("couldn't update file_search: engine said no")
    expect(switchFor('file_search')).toHaveAttribute('aria-checked', 'false')
  })

  it('marks fixture data as offline when the engine is unreachable', async () => {
    const source = withFallback({ list: () => Promise.reject(new Error('down')), setRequireApproval: vi.fn() }, fixture())
    render(<ToolsManager size="2x2" source={source} now={now} />)
    expect(await screen.findByText('offline · fixture')).toBeInTheDocument()
    expect(screen.queryByText('live')).toBeNull()
  })

  it('shows an error with retry when the source fails', async () => {
    let calls = 0
    const base = fixture()
    const flaky: ToolsSource = {
      list: () => (calls++ === 0 ? Promise.reject(new Error('boom')) : base.list()),
      setRequireApproval: base.setRequireApproval,
    }
    render(<ToolsManager size="2x2" source={flaky} now={now} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    fireEvent.click(screen.getByRole('button', { name: 'try again' }))
    expect(await screen.findByText('file_search')).toBeInTheDocument()
  })

  it('shows an empty state when no tools are registered', async () => {
    const empty: ToolsSource = { list: async () => [], setRequireApproval: vi.fn() }
    render(<ToolsManager size="2x2" source={empty} now={now} />)
    expect(await screen.findByText('the engine has no tools registered')).toBeInTheDocument()
  })

  it('renders "blocked" instead of a toggle for denied tools', async () => {
    const denied = { ...(await fixture().list())[0], policy: 'denied', availability: 'disabled' } as EngineTool
    render(<ToolsManager size="2x2" source={{ list: async () => [denied], setRequireApproval: vi.fn() }} now={now} />)
    expect(await screen.findByText('blocked')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('designs every registered size', async () => {
    const { unmount } = render(<ToolsManager size="2x1" source={fixture()} now={now} />)
    expect(await screen.findByText('9 tools · 5 need approval')).toBeInTheDocument()
    expect(screen.getByText('read 4 · mutate 3 · network 2')).toBeInTheDocument()
    expect(screen.getByText('last: system_diagnostics 4m ago')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).toBeNull()
    unmount()

    render(<ToolsManager size="4x2" source={fixture()} now={now} />)
    await screen.findByText('file_search')
    expect(document.querySelector('.w-tools-list[data-wide]')).not.toBeNull()
    expect(screen.getByText('Search public webpages for source URLs and excerpts.')).toBeInTheDocument()
    expect(within(row('search_web')).getByText('network tools always ask first')).toBeInTheDocument()
  })
})

describe('ago', () => {
  it('formats relative times', () => {
    expect(ago(null, NOW)).toBe('never used')
    expect(ago(new Date(NOW - 20_000).toISOString(), NOW)).toBe('just now')
    expect(ago(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5m ago')
    expect(ago(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3h ago')
    expect(ago(new Date(NOW - 50 * 3_600_000).toISOString(), NOW)).toBe('2d ago')
  })
})
