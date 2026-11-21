import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultStorage,
  localStorageBackend,
  memoryStorage,
  tauriStorage,
  type StorageFiles,
} from './index'

// The storage seam: one contract, three backends. The Tauri backend is exercised
// against a fake fs so the path/creation logic is testable without the desktop app.

afterEach(() => {
  window.localStorage.clear()
})

describe('memoryStorage', () => {
  it('round-trips and reports a snapshot', async () => {
    const store = memoryStorage({ notes: 'seeded' })
    expect(await store.read('notes')).toBe('seeded')

    await store.write('notes', 'changed')
    expect(await store.read('notes')).toBe('changed')
    expect(store.snapshot()).toEqual({ notes: 'changed' })

    await store.remove('notes')
    expect(await store.read('notes')).toBeNull()
    expect(store.snapshot()).toEqual({})
  })

  it('rejects keys that would escape the storage folder', async () => {
    const store = memoryStorage()
    await expect(store.write('../secret', 'x')).rejects.toThrow(/invalid storage key/)
    await expect(store.read('Notes')).rejects.toThrow(/invalid storage key/)
  })
})

describe('localStorageBackend', () => {
  it('uses a namespaced key and removes it', async () => {
    const store = localStorageBackend()
    await store.write('notes', 'hello')
    expect(window.localStorage.getItem('nexus.storage.notes')).toBe('hello')
    expect(await store.read('notes')).toBe('hello')

    await store.remove('notes')
    expect(await store.read('notes')).toBeNull()
  })
})

describe('tauriStorage', () => {
  function fakeFiles(seed: Record<string, string> = {}) {
    const files = new Map(Object.entries(seed))
    const calls: string[] = []
    const fs: StorageFiles = {
      async read(path) {
        calls.push(`read:${path}`)
        return files.get(path) ?? ''
      },
      async write(path, data) {
        calls.push(`write:${path}`)
        files.set(path, data)
      },
      async exists(path) {
        calls.push(`exists:${path}`)
        return files.has(path)
      },
      async mkdir(path) {
        calls.push(`mkdir:${path}`)
      },
      async remove(path) {
        calls.push(`remove:${path}`)
        files.delete(path)
      },
    }
    return { fs, files, calls }
  }

  it('returns null for a missing key without reading it', async () => {
    const { fs, calls } = fakeFiles()
    const store = tauriStorage(fs)
    expect(await store.read('notes')).toBeNull()
    expect(calls).toEqual(['exists:storage/notes.txt'])
  })

  it('creates the folder before the first write and reads it back', async () => {
    const { fs, files, calls } = fakeFiles()
    const store = tauriStorage(fs)

    await store.write('notes', 'remember this')
    expect(files.get('storage/notes.txt')).toBe('remember this')
    expect(calls).toEqual(['mkdir:storage', 'write:storage/notes.txt'])

    expect(await store.read('notes')).toBe('remember this')
  })

  it('removes only an existing file', async () => {
    const { fs, calls } = fakeFiles({ 'storage/notes.txt': 'old' })
    const store = tauriStorage(fs)

    await store.remove('notes')
    expect(calls).toEqual(['exists:storage/notes.txt', 'remove:storage/notes.txt'])
    expect(await store.read('notes')).toBeNull()
  })
})

describe('defaultStorage', () => {
  it('falls back to localStorage outside Tauri', () => {
    expect(defaultStorage().kind).toBe('local')
  })
})
