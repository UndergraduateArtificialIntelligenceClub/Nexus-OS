import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FileSource } from './source'
import { fixtureSource } from './source'
import { Files } from './App'

// The widget end-to-end against the fixture source: home → folder → back,
// selecting each preview kind, the 1x1 swap, and honest error/empty states.

const renderFiles = (size: '1x1' | '2x1' | '2x2' = '2x1', source: FileSource = fixtureSource, mode: 'widget' | 'fullscreen' = 'widget') =>
  render(<Files instanceId="test" size={size} mode={mode} source={source} />)

describe('files', () => {
  it('lists the home folder, folders first, with type marks', async () => {
    renderFiles()
    const list = await screen.findByRole('list', { name: 'files' })
    const rows = within(list).getAllByRole('button')

    expect(rows[0]).toHaveTextContent('design')
    expect(rows[1]).toHaveTextContent('bundle.zip')
    expect(within(list).getByText('readme.md')).toBeVisible()
    expect(within(list).getByText('[m]')).toBeVisible()
    expect(screen.getByRole('button', { name: 'home' })).toHaveAttribute('aria-current', 'location')
    expect(screen.getByText('fixture', { selector: '.w-files-source' })).toBeVisible()
  })

  it('opens a folder and comes back through the breadcrumb', async () => {
    const user = userEvent.setup()
    renderFiles()

    await user.click(await screen.findByRole('button', { name: 'design' }))
    expect(await screen.findByRole('button', { name: /colors\.md/ })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'home' }))
    expect(await screen.findByRole('button', { name: /readme\.md/ })).toBeVisible()
  })

  it('renders a selected markdown file', async () => {
    const user = userEvent.setup()
    renderFiles()

    await user.click(await screen.findByRole('button', { name: /readme\.md/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Fixture workspace' })).toBeVisible()
    expect(screen.queryByText(/pick a file to read it/)).not.toBeInTheDocument()
  })

  it('renders a selected image through the asset URL', async () => {
    const user = userEvent.setup()
    const { container } = renderFiles()

    await user.click(await screen.findByRole('button', { name: /dot\.png/ }))
    expect(container.querySelector('img')?.getAttribute('src')).toContain('dot.png')
  })

  it('renders video and audio with native controls', async () => {
    const user = userEvent.setup()
    const { container } = renderFiles()

    await user.click(await screen.findByRole('button', { name: /clip\.mp4/ }))
    expect(container.querySelector('video')).toBeVisible()

    await user.click(screen.getByRole('button', { name: /tone\.wav/ }))
    expect(container.querySelector('audio')).toBeVisible()
  })

  it('shows metadata and an open-with hint for a PDF', async () => {
    const user = userEvent.setup()
    renderFiles()

    await user.click(await screen.findByRole('button', { name: /spec\.pdf/ }))
    expect(await screen.findByText(/pdf document/)).toBeVisible()
    expect(screen.getByText(/open it with your system app/)).toBeVisible()
    expect(within(screen.getByRole('region', { name: 'preview spec.pdf' })).getByText('130 B')).toBeVisible()
  })

  it('swaps the list for the viewer in the 1x1 layout', async () => {
    const user = userEvent.setup()
    renderFiles('1x1')

    await user.click(await screen.findByRole('button', { name: /notes\.txt/ }))
    expect(await screen.findByText(/Nexus OS fixture notes/)).toBeVisible()

    await user.click(screen.getByRole('button', { name: '‹ files' }))
    expect(await screen.findByRole('button', { name: /readme\.md/ })).toBeVisible()
  })

  it('shows an error and retries the folder read', async () => {
    const user = userEvent.setup()
    let calls = 0
    const source: FileSource = {
      ...fixtureSource,
      async readDir(path) {
        calls++
        if (calls === 1) throw new Error('permission denied')
        return fixtureSource.readDir(path)
      },
    }
    renderFiles('2x1', source)

    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied')
    await user.click(screen.getByRole('button', { name: 'try again' }))
    expect(await screen.findByRole('button', { name: /readme\.md/ })).toBeVisible()
  })

  it('retries the home lookup when it fails', async () => {
    const user = userEvent.setup()
    let calls = 0
    const source: FileSource = {
      ...fixtureSource,
      async home() {
        calls++
        if (calls === 1) throw new Error('no home folder')
        return fixtureSource.home()
      },
    }
    renderFiles('2x1', source)

    expect(await screen.findByRole('alert')).toHaveTextContent('no home folder')
    await user.click(screen.getByRole('button', { name: 'try again' }))
    expect(await screen.findByRole('button', { name: /readme\.md/ })).toBeVisible()
  })

  it('shows an empty folder honestly', async () => {
    renderFiles('2x1', { ...fixtureSource, readDir: async () => [] })
    expect(await screen.findByText('this folder is empty.')).toBeVisible()
  })
})
