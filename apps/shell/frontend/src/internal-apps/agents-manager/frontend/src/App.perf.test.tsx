import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusProps } from '@/ui/ai/AgentStatus'
import { liveRosterSource } from './roster'
import { AgentsManager } from './App'
import { T0, agent, fakeFeed, updated } from './testFeed'

// Every roster row renders exactly one AgentStatus, so counting its renders
// counts row renders (2x1 has no detail pane).
const renders = vi.hoisted(() => ({ status: 0 }))

vi.mock('@/ui', async (importOriginal) => {
  const ui = await importOriginal<typeof import('@/ui')>()
  return {
    ...ui,
    AgentStatus: (props: AgentStatusProps) => {
      renders.status += 1
      return <ui.AgentStatus {...props} />
    },
  }
})

const props = { instanceId: 'agents-perf', mode: 'widget' as const, size: '2x1' as const }
const AGENTS = Array.from({ length: 12 }, (_, i) => agent(`task:${i}`, { last_activity: `step ${i}` }))
const text = (id: string, selector: string) =>
  document.querySelector(`.w-agents-row[data-agent-id="${id}"] ${selector}`)!.textContent

async function renderRoster(now?: number) {
  const harness = fakeFeed()
  render(<AgentsManager {...props} source={liveRosterSource(harness.feed)} now={now} />)
  await act(async () => {
    harness.connect(true)
    harness.lists[0].resolve(AGENTS)
  })
  expect(document.querySelectorAll('.w-agents-row')).toHaveLength(12)
  renders.status = 0
  return harness
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AgentsManager with 12 concurrent agents', () => {
  it('re-renders only the row whose agent changed', async () => {
    const harness = await renderRoster(Date.parse(T0))

    act(() => {
      harness.emit(updated(agent('task:7', { last_activity: 'step 7b', updated_at: '2026-11-23T10:00:01Z' })))
    })

    expect(text('task:7', '.w-agents-activity')).toBe('step 7b')
    expect(renders.status).toBe(1)
  })

  it('ticks elapsed times without re-rendering any row', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(Date.parse(T0) + 5_000)
    await renderRoster()
    expect(text('task:3', '.w-agents-elapsed')).toBe('5s')

    act(() => {
      vi.advanceTimersByTime(3_000)
    })

    expect(text('task:3', '.w-agents-elapsed')).toBe('8s')
    expect(text('task:11', '.w-agents-elapsed')).toBe('8s')
    expect(renders.status).toBe(0)
  })
})
