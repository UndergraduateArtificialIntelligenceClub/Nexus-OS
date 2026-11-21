import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { memoryStorage, type KeyValueStorage } from '@/storage'
import { Notes } from './App'

// The notes widget against an in-memory storage backend: load, migrate the old
// localStorage key, debounce a save, survive a close, and say when a save fails.

const renderNotes = (storage: KeyValueStorage, saveDelay = 0) =>
  render(<Notes instanceId="test" size="2x2" mode="widget" storage={storage} saveDelay={saveDelay} />)

afterEach(() => {
  window.localStorage.removeItem('nexus-notes')
})

describe('notes', () => {
  it('loads the stored note', async () => {
    renderNotes(memoryStorage({ notes: 'remember the milk' }))
    expect(await screen.findByDisplayValue('remember the milk')).toBeVisible()
    expect(screen.getByText('saved')).toBeVisible()
  })

  it('migrates the old localStorage note once', async () => {
    window.localStorage.setItem('nexus-notes', 'from the old widget')
    const storage = memoryStorage()
    renderNotes(storage)

    expect(await screen.findByDisplayValue('from the old widget')).toBeVisible()
    await waitFor(() => expect(storage.snapshot().notes).toBe('from the old widget'))
    expect(window.localStorage.getItem('nexus-notes')).toBeNull()
  })

  it('debounces typing into one save and reports it', async () => {
    const user = userEvent.setup()
    const storage = memoryStorage({ notes: '' })
    renderNotes(storage)

    await user.type(await screen.findByLabelText('Notes'), 'a short note')
    await waitFor(() => expect(storage.snapshot().notes).toBe('a short note'))
    expect(screen.getByText('saved')).toBeVisible()
    expect(screen.getByText(/3 words/)).toBeVisible()
  })

  it('flushes a pending save when the widget closes', async () => {
    const user = userEvent.setup()
    const storage = memoryStorage({ notes: '' })
    const { unmount } = renderNotes(storage, 10_000)

    await user.type(await screen.findByLabelText('Notes'), 'closing time')
    unmount()
    await waitFor(() => expect(storage.snapshot().notes).toBe('closing time'))
  })

  it('keeps the text and shows an honest error when saving fails', async () => {
    const user = userEvent.setup()
    const base = memoryStorage({ notes: '' })
    const storage: KeyValueStorage = {
      ...base,
      write: async () => {
        throw new Error('disk full')
      },
    }
    renderNotes(storage)

    await user.type(await screen.findByLabelText('Notes'), 'still here')
    expect(await screen.findByText("couldn't save")).toBeVisible()
    expect(screen.getByLabelText('Notes')).toHaveValue('still here')
  })
})
