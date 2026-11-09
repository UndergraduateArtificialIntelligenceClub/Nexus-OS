/**
 * @vitest-environment jsdom
 *
 * Provider re-render contract (WM-A / Task A1): consumers of useDesktopStore()
 * must update after store actions.
 */

import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useDesktopStore } from '@/wm/DesktopStoreContext'
import { DesktopProvider, useDesktopStoreHandle } from '@/wm/DesktopProvider'
import { createSeedSession } from '@/wm/desktopStore'

function Probe() {
  const { windows, focusedId } = useDesktopStore()
  return (
    <div>
      <span data-testid="count">{windows.length}</span>
      <span data-testid="focused">{focusedId ?? 'none'}</span>
    </div>
  )
}

function OpenButton() {
  const store = useDesktopStore()
  return (
    <button type="button" onClick={() => store.openApp('nexus.terminal', { title: 'Terminal' })}>
      open
    </button>
  )
}

function HandleProbe() {
  const handle = useDesktopStoreHandle()
  return <span data-testid="handle-count">{handle.getState().windows.length}</span>
}

describe('DesktopProvider', () => {
  it('re-renders consumers after openApp', () => {
    const session = createSeedSession()
    render(
      <DesktopProvider initialSession={session} persist={false}>
        <Probe />
        <OpenButton />
      </DesktopProvider>,
    )

    expect(screen.getByTestId('count').textContent).toBe('2')
    expect(screen.getByTestId('focused').textContent).toBe('seed-files')

    act(() => {
      screen.getByRole('button', { name: 'open' }).click()
    })

    expect(screen.getByTestId('count').textContent).toBe('3')
    expect(screen.getByTestId('focused').textContent).not.toBe('seed-files')
    expect(screen.getByTestId('focused').textContent).not.toBe('none')
  })

  it('exposes the raw store handle for IPC', () => {
    render(
      <DesktopProvider initialSession={createSeedSession()} persist={false}>
        <HandleProbe />
      </DesktopProvider>,
    )
    expect(screen.getByTestId('handle-count').textContent).toBe('2')
  })
})
