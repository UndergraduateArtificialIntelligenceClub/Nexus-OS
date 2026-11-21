import { useEffect, useRef, useState } from 'react'
import type { AppProps } from '@/apps/types'
import { defaultStorage, type KeyValueStorage } from '@/storage'
import './notes.css'

// The notes widget: one plain-text note, written through the storage seam so it
// survives a relaunch. Tauri keeps it as a file under AppData; the browser
// fallback keeps it in localStorage. Saves are debounced, and the footer says
// exactly what happened.

const KEY = 'notes'
const LEGACY_KEY = 'nexus-notes'
const SAVE_DELAY = 500

type SaveState = 'loading' | 'saved' | 'saving' | 'error'

export function NotesApp(props: AppProps) {
  const [storage] = useState(defaultStorage)
  return <Notes {...props} storage={storage} />
}

export interface NotesProps extends AppProps {
  storage: KeyValueStorage
  /** Debounce for tests; the widget uses 500 ms. */
  saveDelay?: number
}

export function Notes({ size, storage, saveDelay = SAVE_DELAY }: NotesProps) {
  const [text, setText] = useState('')
  const [state, setState] = useState<SaveState>('loading')
  const latest = useRef('')
  const timer = useRef<number | null>(null)
  const dirty = useRef(false)
  const mounted = useRef(true)
  const seq = useRef(0)

  // Load the stored note; on the first run, adopt the old localStorage note.
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const saved = await storage.read(KEY)
        if (!alive) return
        if (saved !== null) {
          latest.current = saved
          setText(saved)
          setState('saved')
          return
        }

        const legacy = readLegacy()
        if (legacy !== null) {
          latest.current = legacy
          setText(legacy)
          await storage.write(KEY, legacy)
          if (!alive) return
          clearLegacy()
          setState('saved')
          return
        }

        setState('saved')
      } catch {
        if (alive) setState('error')
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [storage])

  // A pending debounce must still land when the widget closes.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
        timer.current = null
        if (dirty.current) void storage.write(KEY, latest.current).catch(() => {})
      }
    }
  }, [storage])

  const save = (value: string) => {
    const id = ++seq.current
    dirty.current = false
    storage
      .write(KEY, value)
      .then(() => {
        if (mounted.current && id === seq.current && !dirty.current) setState('saved')
      })
      .catch(() => {
        if (mounted.current && id === seq.current) setState('error')
      })
  }

  const change = (value: string) => {
    latest.current = value
    dirty.current = true
    setText(value)
    setState('saving')
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      save(latest.current)
    }, saveDelay)
  }

  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const status =
    state === 'loading' ? 'loading…' : state === 'saving' ? 'saving…' : state === 'error' ? "couldn't save" : 'saved'

  return (
    <div className="w-notes" data-size={size}>
      <textarea
        className="w-notes-input"
        aria-label="Notes"
        placeholder="write something…"
        value={text}
        onChange={(e) => change(e.target.value)}
      />
      <footer className="w-notes-foot">
        <span className="w-notes-state" data-error={state === 'error' || undefined} aria-live="polite">
          {state === 'error' && <span aria-hidden="true">x </span>}
          {status}
        </span>
        <span className="w-notes-count">
          {words} {words === 1 ? 'word' : 'words'} · {text.length} {text.length === 1 ? 'char' : 'chars'}
        </span>
      </footer>
    </div>
  )
}

function readLegacy(): string | null {
  try {
    return window.localStorage.getItem(LEGACY_KEY)
  } catch {
    return null
  }
}

function clearLegacy() {
  try {
    window.localStorage.removeItem(LEGACY_KEY)
  } catch {
    /* storage unavailable; the note is already safe */
  }
}
