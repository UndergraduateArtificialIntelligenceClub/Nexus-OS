import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { ArticleBlock } from '@/types/agentEvents'
import { MediaStates } from './MediaStates'
import { SourceBadge } from './SourceBadge'

// ArticleReader: an `article` payload (fetch_article, the browser, the engine) set
// for reading. Prose in the Bubble scale at widget sizes and the Text scale once
// there's room, on a ~65ch measure. Evidence refs are mandatory attribution, so
// they always show as source badges.
//
// It keeps its place: resizing, going fullscreen or coming back from the dock
// reflows the text (and moving the widget's div resets the browser's scroll), so
// the reader remembers which block was at the top, and how far into it, and puts
// that same spot back at the top.

export interface ArticleReaderProps {
  title: string
  blocks: ArticleBlock[]
  evidenceRefs: string[]
  /** Where the article came from, shown under the title. */
  source?: string
  /**
   * Anything that reflows the text without changing the article, e.g.
   * `${size}:${mode}`. When it changes, the reader puts the same block back at the top.
   */
  layoutKey?: string
  className?: string
}

export function ArticleReader({ title, blocks, evidenceRefs, source, layoutKey = '', className }: ArticleReaderProps) {
  const ref = useRef<HTMLElement>(null)
  const onScroll = useScrollAnchor(ref, layoutKey, blocks)

  return (
    <article
      ref={ref}
      className={className ? `nx-article ${className}` : 'nx-article'}
      aria-label={title}
      // Focusable so the keyboard can scroll it (arrows, page keys, space).
      tabIndex={0}
      onScroll={onScroll}
    >
      <header className="nx-article-head" data-anchor="">
        <h1 className="nx-article-title">{title}</h1>
        {source && <SourceBadge source={source} />}
      </header>
      {blocks.length === 0 ? (
        <MediaStates state="empty" emptyHint="this page has no text." className="nx-article-empty" />
      ) : (
        blocks.map((b, i) => <Block key={i} block={b} />)
      )}
      {evidenceRefs.length > 0 && (
        <footer className="nx-article-evidence" data-anchor="" aria-label="sources">
          {evidenceRefs.map((r) => (
            <SourceBadge key={r} source={r} />
          ))}
        </footer>
      )}
    </article>
  )
}

/** The article's title is the h1, so a level-1 block heading is an h2. */
function Block({ block }: { block: ArticleBlock }) {
  switch (block.kind) {
    case 'heading': {
      const Tag = (['h2', 'h3', 'h4'] as const)[block.level - 1]
      return (
        <Tag className={`nx-article-h nx-article-h${block.level}`} data-anchor="">
          {block.text}
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p className="nx-article-p" data-anchor="">
          {block.text}
        </p>
      )
    case 'list':
      return (
        <ul className="nx-article-ul" data-anchor="">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )
  }
}

type Anchor = { index: number; fraction: number }
const TOP: Anchor = { index: 0, fraction: 0 }

/**
 * Remembers the reading position as "block N, this far in" rather than pixels,
 * so it survives reflow. Returns the scroll handler for the scroller.
 */
function useScrollAnchor(ref: RefObject<HTMLElement | null>, layoutKey: string, content: unknown) {
  const anchor = useRef<Anchor>(TOP)
  // Set while the layout has changed and the old spot isn't back yet. Scroll
  // events in that window come from the browser resetting a moved div, not the reader.
  const pending = useRef(false)

  const marks = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-anchor]') ?? [])
  const showing = (el: HTMLElement | null): el is HTMLElement => !!el && el.isConnected && el.clientHeight > 0

  /** Puts the remembered spot back at the top. False if the reader isn't laid out yet. */
  const restore = useCallback(() => {
    const el = ref.current
    if (!showing(el)) return false
    const mark = marks()[anchor.current.index]
    el.scrollTop = mark ? mark.offsetTop + anchor.current.fraction * mark.offsetHeight : 0
    pending.current = false
    return true
  }, [ref])

  const onScroll = useCallback(() => {
    const el = ref.current
    if (pending.current || !showing(el)) return
    const top = el.scrollTop
    const all = marks()
    // The first block whose bottom is still below the top edge.
    let i = 0
    while (i < all.length - 1 && all[i].offsetTop + all[i].offsetHeight <= top) i++
    const m = all[i]
    const fraction = m && m.offsetHeight > 0 ? (top - m.offsetTop) / m.offsetHeight : 0
    anchor.current = { index: i, fraction: Math.min(1, Math.max(0, fraction)) }
  }, [ref])

  // A new article starts at the top.
  useLayoutEffect(() => {
    anchor.current = TOP
    pending.current = false
    if (ref.current) ref.current.scrollTop = 0
  }, [ref, content])

  // The layout changed: put the spot back now, and again once the shell has moved
  // the widget's div into its new container. Stays pending while minimized.
  const firstLayout = useRef(true)
  useLayoutEffect(() => {
    if (firstLayout.current) {
      firstLayout.current = false
      return
    }
    pending.current = true
    restore()
    const frame = requestAnimationFrame(() => restore())
    return () => cancelAnimationFrame(frame)
  }, [layoutKey, restore])

  // The box itself changed size (window resize, a flight settling): same spot.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(() => restore())
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, restore])

  return onScroll
}
