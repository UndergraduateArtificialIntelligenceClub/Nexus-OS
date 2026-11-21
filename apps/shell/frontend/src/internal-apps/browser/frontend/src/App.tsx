import { useCallback, useState } from 'react'
import { ArticleReader, MediaSurface, SearchField, VideoPlayer, useDesktopCommands } from '@/ui'
import type { AppMode, AppProps } from '@/apps/types'
import { showInWidget } from '@/apps/mediaInbox'
import type { Size } from '@/wm/layout'
import { fixtureSource, type BrowserSource, type ReadPayload, type SearchPayload } from './source'
import './browser.css'

// The headless browser widget: renders the typed payloads the search team's
// tools produce (search results, article blocks, images, video) through the
// media kit. The engine isn't wired yet — the data comes from the BrowserSource
// seam, currently the offline fixture source. Articles and video can be sent on
// to their own widgets (reader, video) through the media inbox.

type View = { kind: 'home' } | { kind: 'search'; payload: SearchPayload } | { kind: 'read'; payload: ReadPayload; url: string }

export function BrowserApp({ size, mode }: AppProps) {
  const wide = size === '4x2' || mode === 'fullscreen'
  const commands = useDesktopCommands()
  const [view, setView] = useState<View>({ kind: 'home' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (work: () => Promise<View>) => {
    setBusy(true)
    setError(null)
    try {
      setView(await work())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'the source failed.')
    } finally {
      setBusy(false)
    }
  }, [])

  const search = useCallback(
    (source: BrowserSource, query: string) => run(async () => ({ kind: 'search', payload: await source.search(query) })),
    [run],
  )
  const read = useCallback(
    (source: BrowserSource, url: string) => run(async () => ({ kind: 'read', payload: await source.open(url), url })),
    [run],
  )

  return (
    <Browser
      source={fixtureSource}
      size={size}
      mode={mode}
      wide={wide}
      view={view}
      busy={busy}
      error={error}
      onSearch={search}
      onRead={read}
      onHome={() => setView({ kind: 'home' })}
      onShowInWidget={(payload) => showInWidget(payload, commands)}
    />
  )
}

interface BrowserProps {
  source: BrowserSource
  size: Size
  mode: AppMode
  wide: boolean
  view: View
  busy: boolean
  error: string | null
  onSearch: (source: BrowserSource, query: string) => void
  onRead: (source: BrowserSource, url: string) => void
  /** Leave the current page for the search home. */
  onHome: () => void
  /** Send an article or video to its own widget; answers with the desk's reply. */
  onShowInWidget: (payload: Extract<ReadPayload, { kind: 'article' | 'video' }>) => string
}

export function Browser({ source, size, mode, wide, view, busy, error, onSearch, onRead, onHome, onShowInWidget }: BrowserProps) {
  const [query, setQuery] = useState('')
  const [crumb, setCrumb] = useState<string | null>(null)
  // The desk's answer to "open as widget", for the page it was asked on.
  const [reply, setReply] = useState<{ view: View; text: string } | null>(null)
  const page = view.kind === 'read' && view.payload.kind !== 'image' ? view.payload : null

  const submit = () => {
    const q = query.trim()
    if (!q || busy) return
    setCrumb(q)
    onSearch(source, q)
  }

  return (
    <div className="w-browser" data-wide={wide || undefined}>
      <div className="w-browser-bar">
        <SearchField
          label="search the web"
          placeholder={crumb ?? 'ask the web…'}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          className="w-browser-field"
        />
        {view.kind !== 'home' && (
          <button
            type="button"
            className="w-browser-back"
            onClick={() => {
              onHome()
              setCrumb(null)
            }}
          >
            ‹ back
          </button>
        )}
        {page && !busy && (
          <button type="button" className="w-browser-back" onClick={() => setReply({ view, text: onShowInWidget(page) })}>
            open as widget
          </button>
        )}
      </div>

      {busy && <p className="w-browser-note">loading…</p>}
      {error && <p className="w-browser-note" data-error>{error}</p>}
      {reply?.view === view && (
        <p className="w-browser-note" role="status">
          {reply.text}
        </p>
      )}

      {!busy && !error && view.kind === 'home' && (
        <p className="w-browser-note">search, or open a result — text, images and video come from the source seam.</p>
      )}

      {!busy && !error && view.kind === 'search' && (
        <Results payload={view.payload} wide={wide} compact={size === '2x1'} onRead={(url) => onRead(source, url)} />
      )}

      {!busy && !error && view.kind === 'read' && <Reader payload={view.payload} url={view.url} wide={wide} size={size} mode={mode} />}
    </div>
  )
}

function Results({
  payload,
  wide,
  compact,
  onRead,
}: {
  payload: SearchPayload
  wide: boolean
  compact: boolean
  onRead: (url: string) => void
}) {
  const list = compact ? payload.results.slice(0, 3) : payload.results
  return (
    <div className="w-browser-results">
      <p className="w-browser-note">
        {payload.results.length} results for “{payload.query}”
      </p>
      <ul className="w-browser-list">
        {list.map((r) => (
          <li key={r.url}>
            <button type="button" className="w-browser-hit" onClick={() => onRead(r.url)}>
              <span className="w-browser-title">{r.title}</span>
              <span className="w-browser-url">{r.url}</span>
              {wide && <span className="w-browser-snippet">{r.snippet}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Reader({ payload, url, wide, size, mode }: { payload: ReadPayload; url: string; wide: boolean; size: Size; mode: AppMode }) {
  if (payload.kind === 'article') {
    return (
      <ArticleReader
        className="w-browser-article"
        title={payload.title}
        blocks={payload.blocks}
        evidenceRefs={payload.evidenceRefs}
        layoutKey={`${size}:${mode}`}
      />
    )
  }
  if (payload.kind === 'image') {
    return <MediaSurface src={payload.src} alt={payload.alt} source={payload.source} fit={wide ? 'contain' : 'cover'} caption={url} />
  }
  return (
    <VideoPlayer
      className="w-browser-player"
      src={payload.src}
      poster={payload.poster}
      source={payload.source}
      density={size === '2x1' && !wide ? 'min' : 'full'}
      mode={mode}
    />
  )
}
