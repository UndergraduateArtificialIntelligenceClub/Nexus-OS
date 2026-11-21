import { convertFileSrc, isTauri } from '@tauri-apps/api/core'
import { homeDir, join } from '@tauri-apps/api/path'
import { readDir, readTextFile, stat } from '@tauri-apps/plugin-fs'
import { openPath } from '@tauri-apps/plugin-opener'
import bundleZip from './__fixtures__/bundle.zip?url'
import clipMp4 from './__fixtures__/clip.mp4?url'
import colors from './__fixtures__/design/colors.md?raw'
import dotPng from './__fixtures__/dot.png?url'
import code from './__fixtures__/hello.ts?raw'
import notes from './__fixtures__/notes.txt?raw'
import readme from './__fixtures__/readme.md?raw'
import specPdf from './__fixtures__/spec.pdf?url'
import toneWav from './__fixtures__/tone.wav?url'

// The files data seam. Inside Tauri it reads the real home directory through
// plugin-fs and serves media through the asset protocol. In a browser it serves
// a bundled fixture tree, so the widget and its tests work without the desktop.

export interface FileEntry {
  name: string
  /** Absolute path in Tauri; a fixture path in the browser. */
  path: string
  isDir: boolean
  size?: number
  /** Milliseconds since the epoch, when the platform reports it. */
  modified?: number
}

export interface FileSource {
  readonly kind: 'tauri' | 'fixture'
  /** Short name for the root in breadcrumbs. */
  readonly rootLabel: string
  /** Whether the platform can hand a file to its default app. */
  readonly canOpen: boolean
  home(): Promise<string>
  readDir(path: string): Promise<FileEntry[]>
  readText(path: string): Promise<string>
  /** A URL the webview can load (asset protocol or an inline data URI). */
  assetUrl(path: string): string
  openPath(path: string): Promise<void>
}

// --- Tauri: the real home folder ---

export function tauriSource(): FileSource {
  return {
    kind: 'tauri',
    rootLabel: '~',
    canOpen: true,

    home: () => homeDir(),

    async readDir(path) {
      const entries = await readDir(path)
      return Promise.all(
        entries.map(async (entry) => {
          const full = await join(path, entry.name)
          let size: number | undefined
          let modified: number | undefined
          if (!entry.isDirectory) {
            try {
              const info = await stat(full)
              size = info.size
              modified = info.mtime?.getTime()
            } catch {
              // The entry can vanish between readDir and stat; list it anyway.
            }
          }
          return { name: entry.name, path: full, isDir: entry.isDirectory, size, modified }
        }),
      )
    },

    readText: (path) => readTextFile(path),
    assetUrl: (path) => convertFileSrc(path),
    openPath: (path) => openPath(path),
  }
}

// --- Fixture: a real little tree bundled with the widget ---

type FixtureNode =
  | { kind: 'dir'; name: string; children: FixtureNode[] }
  | { kind: 'file'; name: string; text?: string; asset?: string; size?: number; modified?: number }

const HOUR = 60 * 60_000
const DAY = 24 * HOUR
// A fixed clock keeps fixture dates and tests stable.
const NOW = Date.UTC(2026, 10, 21, 12)

const TREE: FixtureNode = {
  kind: 'dir',
  name: 'home',
  children: [
    {
      kind: 'dir',
      name: 'design',
      children: [
        { kind: 'file', name: 'colors.md', text: colors, size: colors.length, modified: NOW - 6 * HOUR },
      ],
    },
    { kind: 'file', name: 'readme.md', text: readme, size: readme.length, modified: NOW - 2 * HOUR },
    { kind: 'file', name: 'notes.txt', text: notes, size: notes.length, modified: NOW - DAY },
    { kind: 'file', name: 'hello.ts', text: code, size: code.length, modified: NOW - 2 * DAY },
    { kind: 'file', name: 'dot.png', asset: dotPng, size: 550, modified: NOW - 3 * DAY },
    { kind: 'file', name: 'tone.wav', asset: toneWav, size: 8_044, modified: NOW - 4 * DAY },
    { kind: 'file', name: 'clip.mp4', asset: clipMp4, size: 1_493, modified: NOW - 5 * DAY },
    { kind: 'file', name: 'spec.pdf', asset: specPdf, size: 130, modified: NOW - 6 * DAY },
    { kind: 'file', name: 'bundle.zip', asset: bundleZip, size: 22, modified: NOW - 8 * DAY },
  ],
}

const HOME = 'fixture://home'

function childAt(path: string): FixtureNode | null {
  if (path === HOME) return TREE
  if (!path.startsWith(`${HOME}/`)) return null
  let node: FixtureNode = TREE
  for (const part of path.slice(HOME.length + 1).split('/')) {
    if (node.kind !== 'dir') return null
    const next = node.children.find((child) => child.name === part)
    if (!next) return null
    node = next
  }
  return node
}

function entryFor(node: FixtureNode, parent: string): FileEntry {
  return {
    name: node.name,
    path: `${parent}/${node.name}`,
    isDir: node.kind === 'dir',
    size: node.kind === 'file' ? node.size : undefined,
    modified: node.kind === 'file' ? node.modified : undefined,
  }
}

export const fixtureSource: FileSource = {
  kind: 'fixture',
  rootLabel: 'home',
  canOpen: false,

  async home() {
    return HOME
  },

  async readDir(path) {
    const node = childAt(path)
    if (!node || node.kind !== 'dir') throw new Error(`no folder at ${path}.`)
    return node.children.map((child) => entryFor(child, path))
  },

  async readText(path) {
    const node = childAt(path)
    if (!node || node.kind !== 'file') throw new Error(`no file at ${path}.`)
    if (node.text === undefined) throw new Error(`${node.name} has no text preview.`)
    return node.text
  },

  assetUrl(path) {
    const node = childAt(path)
    return node?.kind === 'file' ? (node.asset ?? '') : ''
  },

  async openPath() {
    throw new Error('opening files needs the desktop app.')
  },
}

/** The real home folder inside Tauri, the bundled fixture everywhere else. */
export function defaultFileSource(): FileSource {
  return isTauri() ? tauriSource() : fixtureSource
}
