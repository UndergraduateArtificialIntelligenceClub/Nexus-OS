import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AppMode } from '@/apps/types'
import type { FileEntry, FileSource } from './source'
import { FileViewer } from './viewers'

// Every renderer against a fake source: markdown, text, code, image, video,
// audio, and the metadata panel for types without a preview.

const NOW = new Date('2026-11-21T12:00:00').getTime()

const file = (name: string, extra: Partial<FileEntry> = {}): FileEntry => ({
  name,
  path: `fx://home/${name}`,
  isDir: false,
  size: 1200,
  modified: NOW,
  ...extra,
})

function fakeSource(overrides: Partial<FileSource> = {}): FileSource {
  return {
    kind: 'fixture',
    rootLabel: 'fixture',
    canOpen: false,
    home: async () => 'fx://home',
    readDir: async () => [],
    readText: async () => 'text body',
    assetUrl: (path) => `asset:${path}`,
    openPath: async () => {},
    ...overrides,
  }
}

const renderViewer = (entry: FileEntry, source = fakeSource(), mode: AppMode = 'widget') =>
  render(<FileViewer file={entry} source={source} mode={mode} />)

describe('FileViewer', () => {
  it('renders markdown as a document', async () => {
    renderViewer(file('readme.md'), fakeSource({ readText: async () => '# Hello\n\nBody **strong**' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Hello' })).toBeVisible()
    expect(screen.getByText('strong').tagName).toBe('STRONG')
  })

  it('renders plain text as mono with whitespace kept', async () => {
    const { container } = renderViewer(
      file('notes.txt'),
      fakeSource({ readText: async () => 'line one\n  line two' }),
    )

    await waitFor(() => expect(container.querySelector('pre')).not.toBeNull())
    expect(container.querySelector('pre')?.textContent).toBe('line one\n  line two')
  })

  it('labels code with its extension', async () => {
    const { container } = renderViewer(file('hello.ts'), fakeSource({ readText: async () => 'const x = 1' }))

    await waitFor(() => expect(container.querySelector('pre')).not.toBeNull())
    expect(container.querySelector('pre')).toHaveAttribute('data-lang', 'ts')
    expect(container.querySelector('pre')?.textContent).toBe('const x = 1')
  })

  it('shows an image through the source asset URL', () => {
    const { container } = renderViewer(file('dot.png', { size: 550 }))
    expect(container.querySelector('img')).toHaveAttribute('src', 'asset:fx://home/dot.png')
  })

  it('shows a video with native controls', () => {
    const { container } = renderViewer(file('clip.mp4'))
    const video = container.querySelector('video')
    expect(video).toHaveAttribute('src', 'asset:fx://home/clip.mp4')
    expect(video).toHaveAttribute('controls')
  })

  it('shows audio with native controls', () => {
    const { container } = renderViewer(file('tone.wav'))
    const audio = container.querySelector('audio')
    expect(audio).toHaveAttribute('src', 'asset:fx://home/tone.wav')
    expect(audio).toHaveAttribute('controls')
  })

  it('shows metadata and an open-with hint for unsupported types', () => {
    renderViewer(file('spec.pdf', { size: 130 }))

    expect(screen.getByText(/pdf document · \.pdf/)).toBeVisible()
    expect(screen.getByText('130 B')).toBeVisible()
    expect(screen.getByText(/open it with your system app/)).toBeVisible()
    expect(screen.queryByRole('button', { name: /open with/ })).toBeNull()
  })

  it('offers the system opener when the platform has one', async () => {
    const user = userEvent.setup()
    const openPath = vi.fn(async () => {})
    renderViewer(file('bundle.zip'), fakeSource({ canOpen: true, openPath }))

    await user.click(screen.getByRole('button', { name: 'open with system app' }))
    expect(openPath).toHaveBeenCalledWith('fx://home/bundle.zip')
  })

  it('reports an opener failure without losing the panel', async () => {
    const user = userEvent.setup()
    renderViewer(
      file('bundle.zip'),
      fakeSource({
        canOpen: true,
        openPath: async () => {
          throw new Error('no handler installed')
        },
      }),
    )

    await user.click(screen.getByRole('button', { name: 'open with system app' }))
    expect(await screen.findByText(/no handler installed/)).toBeVisible()
    expect(screen.getByText(/open it with your system app/)).toBeVisible()
  })

  it('shows a read error and retries', async () => {
    const user = userEvent.setup()
    let calls = 0
    const source = fakeSource({
      readText: async () => {
        calls++
        if (calls === 1) throw new Error('unreadable file')
        return 'second try'
      },
    })
    renderViewer(file('notes.txt'), source)

    expect(await screen.findByRole('alert')).toHaveTextContent('unreadable file')
    await user.click(screen.getByRole('button', { name: 'try again' }))
    expect(await screen.findByText('second try')).toBeVisible()
  })

  it('clips a very large text file and says so', async () => {
    renderViewer(file('notes.txt', { size: 400 * 1024 }), fakeSource({ readText: async () => 'x'.repeat(300_000) }))
    expect(await screen.findByText(/showing the first 256\.0 KB of 400\.0 KB/)).toBeVisible()
  })
})
