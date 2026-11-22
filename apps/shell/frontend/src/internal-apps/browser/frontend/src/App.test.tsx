import { beforeEach, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getMedia, resetInboxForTests } from '@/apps/mediaInbox'
import { DesktopProvider, createDesktopStore, defaultDesktop, type DesktopState } from '@/wm/desktopStore'
import { BrowserApp } from './App'

// The widget end-to-end against the offline fixture source: home → search →
// results → read → back. The fixture's 240 ms latency is real, so waits use
// findBy*.

beforeEach(() => {
  localStorage.clear()
  resetInboxForTests()
})

function renderBrowser(size: '2x2' | '4x2' = '2x2', desk?: DesktopState) {
  return render(
    <DesktopProvider initial={desk}>
      <BrowserApp instanceId="test" size={size} mode="widget" />
    </DesktopProvider>,
  )
}

it('shows the honest home note before any search', () => {
  renderBrowser()
  expect(screen.getByText(/search, or open a result/)).toBeVisible()
})

it('does nothing on an empty query', async () => {
  const user = userEvent.setup()
  renderBrowser()
  await user.type(screen.getByLabelText(/search the web/i), '{Enter}')
  expect(screen.getByText(/search, or open a result/)).toBeVisible()
})

it('searches, opens a result, reads the article, and comes back', async () => {
  const user = userEvent.setup()
  renderBrowser('4x2')

  await user.type(screen.getByLabelText(/search the web/i), 'grid{Enter}')
  expect(await screen.findByText(/4 results for/)).toBeVisible()

  await user.click(screen.getByRole('button', { name: /grid snapping/i }))
  expect(await screen.findByText('Cells, not pixels')).toBeVisible()
  expect(screen.getByText('wm/layout.ts')).toBeVisible() // evidence badge

  await user.click(screen.getByRole('button', { name: /back/ }))
  expect(screen.getByText(/search, or open a result/)).toBeVisible()
})

it('sends an article to the reader widget, and says what the desk did', async () => {
  const user = userEvent.setup()
  // A desk with room: the stock one minus the clock.
  const store = createDesktopStore(defaultDesktop())
  store.close('clock')
  renderBrowser('4x2', store.getState())

  await user.type(screen.getByLabelText(/search the web/i), 'grid{Enter}')
  await user.click(await screen.findByRole('button', { name: /grid snapping/i }))
  await screen.findByText('Cells, not pixels')

  await user.click(screen.getByRole('button', { name: 'open as widget' }))
  expect(getMedia('article')?.title).toMatch(/grid snapping/i)
  expect(screen.getByRole('status')).toHaveTextContent('placed reader.')

  // The reply belongs to that page.
  await user.click(screen.getByRole('button', { name: /back/ }))
  expect(screen.queryByRole('status')).toBeNull()
})

it('plays the fixture clip in the player, and offers it to the video widget', async () => {
  const user = userEvent.setup()
  const { container } = renderBrowser('4x2')
  await user.type(screen.getByLabelText(/search the web/i), 'all-hands{Enter}')
  await user.click(await screen.findByRole('button', { name: /all-hands/i }))
  expect(await screen.findByRole('group', { name: /video player/ })).toBeVisible()
  expect(container.querySelector('video')).toHaveAttribute('src', '/fixtures/test-pattern.mp4')

  await user.click(screen.getByRole('button', { name: 'open as widget' }))
  expect(getMedia('video')?.src).toBe('/fixtures/test-pattern.mp4')
  // The stock desk has one free cell: the widget steps down to 1x1 to fit.
  expect(screen.getByText('placed video.')).toBeVisible()
})

it('offers no widget for an image', async () => {
  const user = userEvent.setup()
  const { container } = renderBrowser('4x2')
  await user.type(screen.getByLabelText(/search the web/i), 'metrics{Enter}')
  await user.click(await screen.findByRole('button', { name: /weekly metrics/i }))
  await waitFor(() => expect(container.querySelector('.nx-media-img')).not.toBeNull())
  expect(screen.queryByRole('button', { name: 'open as widget' })).toBeNull()
})
