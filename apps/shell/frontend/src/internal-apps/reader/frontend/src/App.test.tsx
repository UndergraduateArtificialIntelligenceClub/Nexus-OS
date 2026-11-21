import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { getApp } from '@/apps/registry'
import { putMedia, resetInboxForTests, type ArticlePayload } from '@/apps/mediaInbox'
import { parseCommand } from '@/shell/agent/parseCommand'
import { createDesktopStore, defaultDesktop } from '@/wm/desktopStore'
import { checkInvariants } from '@/wm/testing/gridInvariants'
import { ReaderApp } from './App'

beforeEach(() => {
  localStorage.clear()
  resetInboxForTests()
})

const ARTICLE: ArticlePayload = {
  kind: 'article',
  title: 'Grid snapping',
  blocks: [
    { kind: 'heading', level: 1, text: 'Cells, not pixels' },
    { kind: 'paragraph', text: 'A widget claims whole cells.' },
  ],
  evidenceRefs: ['wm/layout.ts'],
}

describe('reader widget', () => {
  it('asks for an article when the inbox is empty', () => {
    render(<ReaderApp instanceId="r" size="2x2" mode="widget" />)
    expect(screen.getByText('open an article from the browser')).toBeVisible()
  })

  it('reads what the inbox holds, with its evidence', () => {
    putMedia(ARTICLE)
    render(<ReaderApp instanceId="r" size="2x2" mode="widget" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Grid snapping' })).toBeVisible()
    expect(screen.getByText('A widget claims whole cells.')).toBeVisible()
    expect(screen.getByLabelText('Source: wm/layout.ts')).toBeVisible()
    act(() => putMedia({ ...ARTICLE, title: 'When space runs out' }))
    expect(screen.getByRole('heading', { level: 1, name: 'When space runs out' })).toBeVisible()
  })

  it('renders at every size it declares, and fullscreen', () => {
    putMedia(ARTICLE)
    const { sizes, fullscreen } = getApp('reader')
    expect(fullscreen).toBe(true)
    for (const size of sizes) {
      const { unmount } = render(<ReaderApp instanceId="r" size={size} mode="widget" />)
      expect(screen.getByRole('article', { name: 'Grid snapping' })).toBeVisible()
      unmount()
    }
    render(<ReaderApp instanceId="r" size="2x2" mode="fullscreen" />)
    expect(screen.getByRole('article', { name: 'Grid snapping' })).toBeVisible()
  })

  it('opens on the default desk without breaking the grid, at every size', () => {
    const store = createDesktopStore(defaultDesktop())
    // The stock desk is nearly full: make room the way a person would.
    store.close('browser')
    expect(store.open('reader')).toMatch(/placed reader/)
    for (const size of getApp('reader').sizes) {
      store.resize('reader', size)
      expect(checkInvariants(store.getState())).toEqual([])
    }
  })

  it('is what the agent opens for articles, but "read my notes" stays with notes', () => {
    expect(parseCommand('open the reader')).toMatchObject({ appId: 'reader' })
    expect(parseCommand('show the article')).toMatchObject({ appId: 'reader' })
    expect(parseCommand('read my notes')).not.toMatchObject({ appId: 'reader' })
  })
})
