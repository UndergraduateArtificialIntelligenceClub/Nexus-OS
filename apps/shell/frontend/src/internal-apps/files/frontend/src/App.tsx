import { useEffect, useState } from 'react'
import type { AppProps } from '@/apps/types'
import { EmptyState, MediaStates } from '@/ui'
import { FILE_GLYPH, classifyFile, formatBytes, formatWhen } from './fileTypes'
import { defaultFileSource, type FileEntry, type FileSource } from './source'
import { FileViewer } from './viewers'
import './files.css'

// The files widget: a real directory (the home folder inside Tauri, a bundled
// fixture tree in the browser), navigable with breadcrumbs, sorted folders
// first, and previewed by type. The 1x1 layout keeps the list and swaps in the
// viewer on selection; larger layouts show both panes.

export function FilesApp(props: AppProps) {
  const [source] = useState(defaultFileSource)
  return <Files {...props} source={source} />
}

export interface FilesProps extends AppProps {
  source: FileSource
}

type Phase = 'loading' | 'ready' | 'error'

export function Files({ size, mode, source }: FilesProps) {
  const [stack, setStack] = useState<string[]>([])
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [homeAttempt, setHomeAttempt] = useState(0)

  const current = stack[stack.length - 1]
  const compact = size === '1x1' && mode !== 'fullscreen'

  // Start at home. A failed home lookup leaves the stack empty and shows the error.
  useEffect(() => {
    let alive = true
    setPhase('loading')
    setError('')
    source
      .home()
      .then((home) => {
        if (alive) setStack([home])
      })
      .catch((e) => {
        if (!alive) return
        setError(messageOf(e))
        setPhase('error')
      })
    return () => {
      alive = false
    }
  }, [source, homeAttempt])

  // Read the current folder whenever it changes (or a retry is asked for).
  useEffect(() => {
    if (!current) return
    let alive = true
    setPhase('loading')
    setError('')
    source
      .readDir(current)
      .then((list) => {
        if (!alive) return
        setEntries(sortEntries(list))
        setPhase('ready')
      })
      .catch((e) => {
        if (!alive) return
        setError(messageOf(e))
        setPhase('error')
      })
    return () => {
      alive = false
    }
  }, [source, current, attempt])

  const go = (index: number) => {
    if (index === stack.length - 1) return
    setStack((s) => s.slice(0, index + 1))
    setSelected(null)
    setEntries([])
    setPhase('loading')
  }

  const up = () => {
    if (stack.length <= 1) return
    setStack((s) => s.slice(0, -1))
    setSelected(null)
    setEntries([])
    setPhase('loading')
  }

  const enter = (entry: FileEntry) => {
    if (!entry.isDir) {
      setSelected(entry)
      return
    }
    setStack((s) => [...s, entry.path])
    setSelected(null)
    setEntries([])
    setPhase('loading')
  }

  const retry = () => {
    if (stack.length === 0) setHomeAttempt((n) => n + 1)
    else setAttempt((n) => n + 1)
  }

  const crumbs = (
    <Crumbs
      stack={stack}
      rootLabel={source.rootLabel}
      fixture={source.kind === 'fixture'}
      onGo={go}
      onUp={up}
    />
  )

  if (compact) {
    return (
      <div className="w-files" data-view="tiny">
        {selected ? (
          <>
            <div className="w-files-crumbs">
              <button type="button" className="w-files-up" onClick={() => setSelected(null)}>
                ‹ files
              </button>
              <span className="w-files-path">{selected.name}</span>
            </div>
            <FileViewer file={selected} source={source} mode={mode} />
          </>
        ) : (
          <>
            {crumbs}
            <FolderBody
              phase={phase}
              error={error}
              entries={entries}
              selected={null}
              onEnter={enter}
              onRetry={retry}
              showMeta={false}
              showDates={false}
            />
          </>
        )}
      </div>
    )
  }

  return (
    <div className="w-files" data-view={mode === 'fullscreen' ? 'full' : 'split'}>
      {crumbs}
      <div className="w-files-body">
        <div className="w-files-pane">
          <FolderBody
            phase={phase}
            error={error}
            entries={entries}
            selected={selected}
            onEnter={enter}
            onRetry={retry}
            showMeta
            showDates={mode === 'fullscreen'}
          />
        </div>
        {selected ? (
          <FileViewer file={selected} source={source} mode={mode} />
        ) : (
          <aside className="w-files-preview--empty">
            <span>pick a file to read it</span>
            <span className="w-files-hint">markdown, text, code, images, video, audio</span>
          </aside>
        )}
      </div>
    </div>
  )
}

function FolderBody({
  phase,
  error,
  entries,
  selected,
  onEnter,
  onRetry,
  showMeta,
  showDates,
}: {
  phase: Phase
  error: string
  entries: FileEntry[]
  selected: FileEntry | null
  onEnter: (entry: FileEntry) => void
  onRetry: () => void
  showMeta: boolean
  showDates: boolean
}) {
  if (phase === 'loading') return <MediaStates state="loading" className="w-files-state" />
  if (phase === 'error') {
    return <MediaStates state="error" message={error} onRetry={onRetry} className="w-files-state" />
  }
  if (entries.length === 0) return <EmptyState hint="this folder is empty." className="w-files-empty" />

  return (
    <ul className="w-files-list" aria-label="files">
      {entries.map((entry) => {
        const category = classifyFile(entry.name, entry.isDir)
        return (
          <li key={entry.path}>
            <button
              type="button"
              className="w-files-row"
              data-sel={selected?.path === entry.path || undefined}
              onClick={() => onEnter(entry)}
            >
              <span className="w-files-mark" aria-hidden="true">
                {FILE_GLYPH[category]}
              </span>
              <span className="w-files-name">{entry.name}</span>
              {showMeta && !entry.isDir && (
                <span className="w-files-when">
                  {formatBytes(entry.size)}
                  {showDates ? ` · ${formatWhen(entry.modified)}` : ''}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Crumbs({
  stack,
  rootLabel,
  fixture,
  onGo,
  onUp,
}: {
  stack: string[]
  rootLabel: string
  fixture: boolean
  onGo: (index: number) => void
  onUp: () => void
}) {
  return (
    <nav className="w-files-crumbs" aria-label="folder">
      {stack.length > 1 && (
        <button type="button" className="w-files-up" onClick={onUp}>
          ‹ up
        </button>
      )}
      <div className="w-files-path">
        {stack.length === 0 ? (
          <span className="w-files-crumb">{rootLabel}</span>
        ) : (
          stack.map((path, i) => (
            <span key={path} className="w-files-crumb-wrap">
              {i > 0 && (
                <span className="w-files-sep" aria-hidden="true">
                  /
                </span>
              )}
              <button
                type="button"
                className="w-files-crumb"
                aria-current={i === stack.length - 1 ? 'location' : undefined}
                onClick={() => onGo(i)}
              >
                {i === 0 ? rootLabel : lastSegment(path)}
              </button>
            </span>
          ))
        )}
      </div>
      {fixture && <span className="w-files-source">fixture</span>}
    </nav>
  )
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

function lastSegment(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "couldn't read that folder."
}
