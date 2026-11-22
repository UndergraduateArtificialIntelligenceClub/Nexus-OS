import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VideoPlayer, formatTime, type VideoPlayerProps } from '@/ui'

// jsdom has no media pipeline: play/pause/load are stubs that fire the events a
// real element would, so the player is tested against what the element reports.
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event('pause'))
  })
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const CLIP = '/fixtures/test-pattern.mp4'

function setup(over: Partial<VideoPlayerProps> = {}) {
  const user = userEvent.setup()
  const props: VideoPlayerProps = { src: CLIP, title: 'test pattern', mode: 'widget', ...over }
  const utils = render(<VideoPlayer {...props} />)
  const video = () => utils.container.querySelector('video')!
  const loaded = (duration = 10) => {
    Object.defineProperty(video(), 'duration', { configurable: true, value: duration })
    fireEvent.loadedMetadata(video())
  }
  return { user, video, loaded, props, ...utils }
}

describe('VideoPlayer', () => {
  it('formats timecodes', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(65.9)).toBe('1:05')
    expect(formatTime(3725)).toBe('1:02:05')
    expect(formatTime(NaN)).toBe('-:--')
    expect(formatTime(Infinity)).toBe('-:--')
  })

  it('is empty without a source', () => {
    setup({ src: '' })
    expect(screen.getByText('nothing here yet')).toBeVisible()
    expect(screen.getByRole('button', { name: 'play' })).toBeDisabled()
  })

  it('loads the poster without autoplaying, and waits for metadata', () => {
    const { video } = setup({ poster: 'data:,' })
    expect(video()).not.toHaveAttribute('autoplay')
    expect(video()).toHaveAttribute('preload', 'metadata')
    expect(video()).toHaveAttribute('poster', 'data:,')
    expect(screen.getByRole('status', { name: 'loading' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'play' })).toBeDisabled()
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  })

  it('plays and pauses from the glyph button, following the element', async () => {
    const { user, loaded } = setup()
    loaded()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('0:10', { exact: false })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'play' }))
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'pause' })).toHaveTextContent('||')

    await user.click(screen.getByRole('button', { name: 'pause' }))
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'play' })).toBeVisible()
  })

  it('stays paused when the browser refuses to play', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(() => Promise.reject(new Error('NotAllowedError')))
    const { user, loaded } = setup()
    loaded()
    await user.click(screen.getByRole('button', { name: 'play' }))
    expect(screen.getByRole('button', { name: 'play' })).toBeVisible()
  })

  it('seeks with the ASCII scrubber and shows the time it reports', async () => {
    const { user, loaded, video } = setup()
    loaded(30)
    const seek = screen.getByRole('slider', { name: 'seek' })
    expect(seek).toHaveAttribute('aria-valuemax', '30')
    seek.focus()
    await user.keyboard('{ArrowRight}')
    expect(video().currentTime).toBe(5)
    expect(seek).toHaveAttribute('aria-valuetext', '0:05 of 0:30')
    await user.keyboard('{End}')
    expect(video().currentTime).toBe(30)

    // Playback moves the reading, not the other way round.
    video().currentTime = 12
    fireEvent.timeUpdate(video())
    expect(seek).toHaveAttribute('aria-valuenow', '12')
    expect(screen.getByText('0:12', { exact: false })).toBeVisible()
  })

  it('sets the volume and mutes', async () => {
    const { user, loaded, video } = setup()
    loaded()
    const vol = screen.getByRole('slider', { name: 'volume' })
    vol.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(video().volume).toBe(0.8)
    expect(vol).toHaveAttribute('aria-valuetext', '80%')

    await user.click(screen.getByRole('button', { name: 'mute' }))
    expect(video().muted).toBe(true)
    expect(vol).toHaveAttribute('aria-valuetext', 'muted')
    expect(vol).toHaveAttribute('aria-valuenow', '0')

    // Turning it up again unmutes.
    vol.focus()
    await user.keyboard('{ArrowUp}')
    expect(video().muted).toBe(false)
    expect(video().volume).toBe(0.1)
  })

  it('answers the player shortcuts from anywhere inside it', async () => {
    const { user, loaded, video } = setup()
    loaded(60)
    const play = screen.getByRole('button', { name: 'play' })
    play.focus()

    await user.keyboard(' ') // presses the focused button: one toggle, not two
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
    await user.keyboard('k')
    expect(screen.getByRole('button', { name: 'play' })).toBeVisible()

    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowLeft}')
    expect(video().currentTime).toBe(5)
    await user.keyboard('{ArrowDown}')
    expect(video().volume).toBe(0.9)
    await user.keyboard('M')
    expect(video().muted).toBe(true)
    await user.keyboard('m')
    expect(video().muted).toBe(false)
  })

  it('leaves modified keys and Escape to the shell', () => {
    const { loaded, video } = setup()
    loaded()
    const group = screen.getByRole('group', { name: 'test pattern, video player' })
    expect(fireEvent.keyDown(group, { key: 'Escape' })).toBe(true) // not prevented
    expect(fireEvent.keyDown(group, { key: 'k', metaKey: true })).toBe(true)
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    expect(video().currentTime).toBe(0)
  })

  it('pauses when its widget is minimized, and does not resume on its own', async () => {
    const { user, loaded, rerender, props } = setup()
    loaded()
    await user.click(screen.getByRole('button', { name: 'play' }))
    rerender(<VideoPlayer {...props} mode="minimized" />)
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    rerender(<VideoPlayer {...props} mode="widget" />)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'play' })).toBeVisible()
  })

  it('shows the error state with a retry that reloads', async () => {
    const { user, video } = setup()
    fireEvent.error(video())
    expect(screen.getByRole('alert')).toHaveTextContent("couldn't play this video.")
    await user.click(screen.getByRole('button', { name: 'try again' }))
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled()
    expect(screen.getByRole('status', { name: 'loading' })).toBeInTheDocument()
  })

  it('starts over when the clip changes', async () => {
    const { user, loaded, rerender, props, video } = setup()
    loaded()
    await user.click(screen.getByRole('button', { name: 'play' }))
    rerender(<VideoPlayer {...props} src="/fixtures/other.mp4" />)
    expect(video()).toHaveAttribute('src', '/fixtures/other.mp4')
    expect(screen.getByRole('status', { name: 'loading' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'play' })).toBeDisabled()
  })

  it('fits a 1x1 with just play and the time', () => {
    const { loaded } = setup({ density: 'min', source: 'fixtures' })
    loaded()
    expect(screen.getByRole('button', { name: 'play' })).toBeEnabled()
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.queryByRole('button', { name: 'mute' })).toBeNull()
    expect(screen.queryByLabelText('Source: fixtures')).toBeNull()
  })

  it('shows every control and the source at full density', () => {
    const { loaded } = setup({ density: 'full', source: 'fixtures' })
    loaded()
    expect(screen.getAllByRole('slider')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'mute' })).toBeEnabled()
    expect(screen.getByLabelText('Source: fixtures')).toBeVisible()
  })
})
