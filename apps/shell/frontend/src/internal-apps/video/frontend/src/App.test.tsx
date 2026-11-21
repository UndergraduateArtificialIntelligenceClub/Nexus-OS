import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { getApp } from '@/apps/registry'
import { putMedia, resetInboxForTests } from '@/apps/mediaInbox'
import { parseCommand } from '@/shell/agent/parseCommand'
import { createDesktopStore, defaultDesktop } from '@/wm/desktopStore'
import { checkInvariants } from '@/wm/testing/gridInvariants'
import { VideoApp, densityFor } from './App'

beforeEach(() => {
  localStorage.clear()
  resetInboxForTests()
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})

const CLIP = { kind: 'video' as const, src: '/fixtures/test-pattern.mp4', poster: 'data:,', source: 'fixtures' }

describe('video widget', () => {
  it('asks for a video when the inbox is empty', () => {
    render(<VideoApp instanceId="v" size="2x2" mode="widget" />)
    expect(screen.getByText('open a video from the browser')).toBeVisible()
  })

  it('plays what the inbox holds, and the newest arrival', () => {
    putMedia(CLIP)
    const { container } = render(<VideoApp instanceId="v" size="2x2" mode="widget" />)
    expect(container.querySelector('video')).toHaveAttribute('src', CLIP.src)
    expect(screen.getByLabelText('Source: fixtures')).toBeVisible()
    act(() => putMedia({ ...CLIP, src: '/fixtures/other.mp4' }))
    expect(container.querySelector('video')).toHaveAttribute('src', '/fixtures/other.mp4')
  })

  it('has a layout for every size it declares, and fullscreen', () => {
    putMedia(CLIP)
    const { sizes, fullscreen } = getApp('video')
    expect(fullscreen).toBe(true)
    expect(sizes.map((s) => densityFor(s, 'widget'))).toEqual(['min', 'bar', 'full', 'full'])
    expect(densityFor('1x1', 'fullscreen')).toBe('full')
    for (const size of sizes) {
      const { unmount } = render(<VideoApp instanceId="v" size={size} mode="widget" />)
      expect(screen.getByRole('group', { name: 'video, video player' })).toHaveAttribute('data-density', densityFor(size, 'widget'))
      expect(screen.getByRole('button', { name: 'play' })).toBeInTheDocument()
      unmount()
    }
  })

  it('opens on the default desk without breaking the grid, at every size', () => {
    const store = createDesktopStore(defaultDesktop())
    // The stock desk is nearly full: make room the way a person would.
    store.close('browser')
    expect(store.open('video')).toMatch(/placed video/)
    for (const size of getApp('video').sizes) {
      store.resize('video', size)
      expect(checkInvariants(store.getState())).toEqual([])
    }
  })

  it('is what the agent opens for "play the clip"', () => {
    expect(parseCommand('open the video player')).toMatchObject({ appId: 'video' })
    expect(parseCommand('play the clip')).toMatchObject({ appId: 'video' })
  })
})
