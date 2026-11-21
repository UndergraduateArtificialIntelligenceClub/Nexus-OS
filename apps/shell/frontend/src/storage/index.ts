import { isTauri } from '@tauri-apps/api/core'
import { BaseDirectory, exists, mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'

// Persistent string storage for shell apps. Notes is the first client; anything
// that has to survive a relaunch can use the same seam. In Tauri each key is a
// plain text file under AppData. In a browser (`npm run dev`) the same contract
// falls back to localStorage, so widgets stay usable outside the desktop shell.

export interface KeyValueStorage {
  readonly kind: 'tauri' | 'local' | 'memory'
  read(key: string): Promise<string | null>
  write(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

/** Keys become file names, so keep them boring and portable. */
const KEY_RE = /^[a-z0-9][a-z0-9._-]*$/

function checkKey(key: string) {
  if (!KEY_RE.test(key)) throw new Error(`invalid storage key: ${key}`)
  return key
}

// --- Tauri: one file per key under AppData/storage ---

const DIR = 'storage'
const fileFor = (key: string) => `${DIR}/${checkKey(key)}.txt`

/** The fs calls the Tauri backend needs. Injectable so the backend is testable. */
export interface StorageFiles {
  read(path: string): Promise<string>
  write(path: string, data: string): Promise<void>
  exists(path: string): Promise<boolean>
  mkdir(path: string): Promise<void>
  remove(path: string): Promise<void>
}

const appDataFiles: StorageFiles = {
  read: (path) => readTextFile(path, { baseDir: BaseDirectory.AppData }),
  write: (path, data) => writeTextFile(path, data, { baseDir: BaseDirectory.AppData }),
  exists: (path) => exists(path, { baseDir: BaseDirectory.AppData }),
  mkdir: (path) => mkdir(path, { baseDir: BaseDirectory.AppData, recursive: true }),
  remove: (path) => remove(path, { baseDir: BaseDirectory.AppData }),
}

export function tauriStorage(files: StorageFiles = appDataFiles): KeyValueStorage {
  return {
    kind: 'tauri',

    async read(key) {
      const path = fileFor(key)
      // A missing file is first launch, not a failure.
      if (!(await files.exists(path))) return null
      return files.read(path)
    },

    async write(key, value) {
      const path = fileFor(key)
      await files.mkdir(DIR)
      await files.write(path, value)
    },

    async remove(key) {
      const path = fileFor(key)
      if (await files.exists(path)) await files.remove(path)
    },
  }
}

// --- Browser fallback ---

const PREFIX = 'nexus.storage.'

export function localStorageBackend(): KeyValueStorage {
  return {
    kind: 'local',
    async read(key) {
      return window.localStorage.getItem(PREFIX + checkKey(key))
    },
    async write(key, value) {
      window.localStorage.setItem(PREFIX + checkKey(key), value)
    },
    async remove(key) {
      window.localStorage.removeItem(PREFIX + checkKey(key))
    },
  }
}

// --- Test / embedding backend ---

export interface MemoryStorage extends KeyValueStorage {
  /** A copy of everything written so far, for assertions. */
  snapshot(): Record<string, string>
}

export function memoryStorage(seed: Record<string, string> = {}): MemoryStorage {
  const values = new Map(Object.entries(seed).map(([key, value]) => [checkKey(key), value]))
  return {
    kind: 'memory',
    async read(key) {
      return values.get(checkKey(key)) ?? null
    },
    async write(key, value) {
      values.set(checkKey(key), value)
    },
    async remove(key) {
      values.delete(checkKey(key))
    },
    snapshot() {
      return Object.fromEntries(values)
    },
  }
}

/** AppData files inside the desktop app, localStorage everywhere else. */
export function defaultStorage(): KeyValueStorage {
  return isTauri() ? tauriStorage() : localStorageBackend()
}
