import { useEffect, useState } from 'react'
import type { AppMode } from '@/apps/types'
import { Button, MediaStates, MediaSurface, useMediaLifecycle } from '@/ui'
import {
  CATEGORY_LABEL,
  FILE_GLYPH,
  classifyFile,
  extensionOf,
  formatBytes,
  formatWhen,
  viewerFor,
} from './fileTypes'
import { Markdown } from './markdown'
import type { FileEntry, FileSource } from './source'

// One viewer per kind: markdown as a document, text and code as mono, images
// through the media kit, video/audio with native controls, and an honest
// metadata panel for types the shell can't render. Media sleeps when the widget
// is minimized, by contract.

/** Stop a runaway text read from freezing the webview; say what was clipped. */
const MAX_TEXT = 256 * 1024

export interface FileViewerProps {
  file: FileEntry
  source: FileSource
  mode: AppMode
}

export function FileViewer({ file, source, mode }: FileViewerProps) {
  const category = classifyFile(file.name, file.isDir)
  const kind = viewerFor(category)

  return (
    <section className="w-files-viewer" aria-label={`preview ${file.name}`}>
      <header className="w-files-viewer-head">
        <span className="w-files-mark" aria-hidden="true">
          {FILE_GLYPH[category]}
        </span>
        <span className="w-files-viewer-name">{file.name}</span>
        <span className="w-files-viewer-meta">
          {formatBytes(file.size)} · {formatWhen(file.modified)}
        </span>
      </header>
      <div className="w-files-viewer-body">
        {kind === 'markdown' || kind === 'text' || kind === 'code' ? (
          <TextViewer file={file} source={source} kind={kind} />
        ) : kind === 'image' ? (
          <ImageViewer file={file} source={source} />
        ) : kind === 'video' || kind === 'audio' ? (
          <MediaPlayer file={file} source={source} mode={mode} kind={kind} />
        ) : (
          <UnsupportedViewer file={file} source={source} />
        )}
      </div>
    </section>
  )
}

function TextViewer({
  file,
  source,
  kind,
}: {
  file: FileEntry
  source: FileSource
  kind: 'markdown' | 'text' | 'code'
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setState('loading')
    source
      .readText(file.path)
      .then((body) => {
        if (!alive) return
        setText(body)
        setState('ready')
      })
      .catch((e) => {
        if (!alive) return
        setMessage(e instanceof Error ? e.message : "couldn't read that file.")
        setState('error')
      })
    return () => {
      alive = false
    }
  }, [file.path, source, attempt])

  if (state !== 'ready') {
    return (
      <MediaStates
        state={state}
        message={message}
        onRetry={() => setAttempt((n) => n + 1)}
        className="w-files-state"
      />
    )
  }

  const clipped = text.length > MAX_TEXT
  const shown = clipped ? text.slice(0, MAX_TEXT) : text

  return (
    <div className="w-files-text">
      {kind === 'markdown' ? (
        <div className="w-files-doc">
          <Markdown source={shown} />
        </div>
      ) : (
        <pre className="w-files-code" data-lang={kind === 'code' ? extensionOf(file.name) || undefined : undefined}>
          <code>{shown}</code>
        </pre>
      )}
      {clipped && (
        <p className="w-files-note">
          showing the first {formatBytes(MAX_TEXT)} of {formatBytes(file.size ?? text.length)}
        </p>
      )}
    </div>
  )
}

function ImageViewer({ file, source }: { file: FileEntry; source: FileSource }) {
  const [attempt, setAttempt] = useState(0)
  return (
    <MediaSurface
      key={`${file.path}:${attempt}`}
      src={source.assetUrl(file.path)}
      alt={file.name}
      fit="contain"
      className="nx-media w-files-image"
      caption={`${formatBytes(file.size)} · ${formatWhen(file.modified)}`}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  )
}

function MediaPlayer({
  file,
  source,
  mode,
  kind,
}: {
  file: FileEntry
  source: FileSource
  mode: AppMode
  kind: 'video' | 'audio'
}) {
  const [media, setMedia] = useState<HTMLMediaElement | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  useMediaLifecycle({ mode, media })

  if (failed) {
    return (
      <MediaStates
        state="error"
        message={`couldn't play ${file.name}.`}
        onRetry={() => {
          setFailed(false)
          setAttempt((n) => n + 1)
        }}
        className="w-files-state"
      />
    )
  }

  const src = source.assetUrl(file.path)
  return (
    <div className="w-files-player" data-kind={kind}>
      {kind === 'video' ? (
        <video
          key={attempt}
          ref={setMedia}
          className="w-files-video"
          controls
          preload="metadata"
          src={src}
          onError={() => setFailed(true)}
        />
      ) : (
        <audio
          key={attempt}
          ref={setMedia}
          className="w-files-audio"
          controls
          preload="metadata"
          src={src}
          onError={() => setFailed(true)}
        />
      )}
      <p className="w-files-note">
        {formatBytes(file.size)} · {formatWhen(file.modified)}
      </p>
    </div>
  )
}

function UnsupportedViewer({ file, source }: { file: FileEntry; source: FileSource }) {
  const category = classifyFile(file.name)
  const ext = extensionOf(file.name)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const open = async () => {
    setBusy(true)
    setError(null)
    try {
      await source.openPath(file.path)
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't open that file.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-files-unsupported">
      <div className="w-files-unsupported-mark" aria-hidden="true">
        {FILE_GLYPH[category]}
      </div>
      <p className="w-files-unsupported-kind">
        {CATEGORY_LABEL[category] ?? category}
        {ext ? ` · .${ext}` : ''}
      </p>
      <dl className="w-files-meta">
        <div>
          <dt>size</dt>
          <dd>{formatBytes(file.size)}</dd>
        </div>
        <div>
          <dt>modified</dt>
          <dd>{formatWhen(file.modified)}</dd>
        </div>
      </dl>
      <p className="w-files-hint">no preview for this type — open it with your system app.</p>
      {source.canOpen && (
        <Button variant="action" onClick={open} disabled={busy}>
          {busy ? 'opening…' : 'open with system app'}
        </Button>
      )}
      {error && (
        <p className="w-files-note" data-error>
          <span aria-hidden="true">x </span>
          {error}
        </p>
      )}
    </div>
  )
}
