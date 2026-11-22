import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ArticleReader, type ArticleReaderProps } from '@/ui'
import type { ArticleBlock } from '@/types/agentEvents'

const BLOCKS: ArticleBlock[] = [
  { kind: 'heading', level: 1, text: 'Cells, not pixels' },
  { kind: 'paragraph', text: 'A widget claims whole cells.' },
  { kind: 'heading', level: 2, text: 'When space runs out' },
  { kind: 'paragraph', text: 'The packer re-places everything biggest-first.' },
  { kind: 'heading', level: 3, text: 'Sizes' },
  { kind: 'list', items: ['1x1', '2x2', '4x2'] },
]

const props = (over: Partial<ArticleReaderProps> = {}): ArticleReaderProps => ({
  title: 'Grid snapping',
  blocks: BLOCKS,
  evidenceRefs: ['wm/layout.ts', 'wm/desktopStore.tsx'],
  layoutKey: '2x2:widget',
  ...over,
})

describe('ArticleReader', () => {
  it('renders the title as h1 and block headings one level down', () => {
    render(<ArticleReader {...props()} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Grid snapping' })).toBeVisible()
    expect(screen.getByRole('heading', { level: 2, name: 'Cells, not pixels' })).toBeVisible()
    expect(screen.getByRole('heading', { level: 3, name: 'When space runs out' })).toBeVisible()
    expect(screen.getByRole('heading', { level: 4, name: 'Sizes' })).toBeVisible()
    expect(screen.getByText('The packer re-places everything biggest-first.')).toBeVisible()
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1x1', '2x2', '4x2'])
  })

  it('attributes every evidence ref and the source with a badge', () => {
    render(<ArticleReader {...props({ source: 'team notes' })} />)
    expect(screen.getByLabelText('Source: team notes')).toBeVisible()
    expect(screen.getByLabelText('Source: wm/layout.ts')).toBeVisible()
    expect(screen.getByLabelText('Source: wm/desktopStore.tsx')).toBeVisible()
  })

  it('is a focusable, named region the keyboard can scroll', () => {
    render(<ArticleReader {...props()} />)
    const article = screen.getByRole('article', { name: 'Grid snapping' })
    expect(article).toHaveAttribute('tabindex', '0')
  })

  it('shows the empty state for a page with no text', () => {
    render(<ArticleReader {...props({ blocks: [], evidenceRefs: [] })} />)
    expect(screen.getByText('this page has no text.')).toBeVisible()
  })

  describe('scroll memory', () => {
    // jsdom has no layout. Fake one: every anchored block is `blockH` tall and they
    // stack from 0 (header = anchor 0). Changing `blockH` is a reflow.
    let blockH = 20
    let laidOut = true
    const saved = new Map<string, PropertyDescriptor | undefined>()
    const fake = (name: string, get: (this: HTMLElement) => number, set?: (this: HTMLElement, v: number) => void) => {
      saved.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name))
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get, set })
    }
    const indexOf = (el: HTMLElement) => {
      const all = Array.from(el.parentElement?.querySelectorAll(':scope > [data-anchor]') ?? [])
      return all.indexOf(el)
    }
    const tops = new WeakMap<HTMLElement, number>()

    beforeEach(() => {
      blockH = 20
      laidOut = true
      fake('offsetTop', function () {
        return this.hasAttribute('data-anchor') ? indexOf(this) * blockH : 0
      })
      fake('offsetHeight', function () {
        return this.hasAttribute('data-anchor') ? blockH : 0
      })
      fake('clientHeight', function () {
        return laidOut && this.classList.contains('nx-article') ? 60 : 0
      })
      fake(
        'scrollTop',
        function () {
          return tops.get(this) ?? 0
        },
        function (v) {
          tops.set(this, v)
        },
      )
    })

    afterEach(() => {
      for (const [name, d] of saved) {
        if (d) Object.defineProperty(HTMLElement.prototype, name, d)
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
      }
      saved.clear()
    })

    const scrollTo = (el: HTMLElement, top: number) => {
      el.scrollTop = top
      fireEvent.scroll(el)
    }

    it('keeps the same block at the top when the text reflows', () => {
      const { rerender } = render(<ArticleReader {...props()} />)
      const article = screen.getByRole('article')
      // Halfway into anchor 3 (the "When space runs out" heading).
      scrollTo(article, 3 * 20 + 10)

      blockH = 50 // narrower: everything is taller
      rerender(<ArticleReader {...props({ layoutKey: '1x2:widget' })} />)
      expect(article.scrollTop).toBe(3 * 50 + 25)

      blockH = 10 // fullscreen: everything is shorter
      rerender(<ArticleReader {...props({ layoutKey: '2x2:fullscreen' })} />)
      expect(article.scrollTop).toBe(3 * 10 + 5)
    })

    it('ignores the scroll reset of a minimized widget and restores on return', () => {
      const { rerender } = render(<ArticleReader {...props()} />)
      const article = screen.getByRole('article')
      scrollTo(article, 2 * 20)

      laidOut = false // in the hidden keep-alive box
      rerender(<ArticleReader {...props({ layoutKey: '2x2:minimized' })} />)
      scrollTo(article, 0) // the browser drops the offset of a moved div

      laidOut = true
      rerender(<ArticleReader {...props({ layoutKey: '2x2:widget' })} />)
      expect(article.scrollTop).toBe(2 * 20)
    })

    it('starts a new article at the top', () => {
      const { rerender } = render(<ArticleReader {...props()} />)
      const article = screen.getByRole('article')
      scrollTo(article, 70)
      rerender(<ArticleReader {...props({ title: 'Another page', blocks: [...BLOCKS] })} />)
      expect(article.scrollTop).toBe(0)
      rerender(<ArticleReader {...props({ title: 'Another page', blocks: [...BLOCKS], layoutKey: '4x2:widget' })} />)
      expect(article.scrollTop).toBe(0)
    })
  })
})
