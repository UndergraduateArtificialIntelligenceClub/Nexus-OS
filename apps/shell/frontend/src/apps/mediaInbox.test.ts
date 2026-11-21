import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  INBOX_KEY,
  getMedia,
  loadInbox,
  putMedia,
  resetInboxForTests,
  showInWidget,
  subscribeMedia,
  useMedia,
  type ArticlePayload,
  type VideoPayload,
} from './mediaInbox'

const ARTICLE: ArticlePayload = {
  kind: 'article',
  title: 'Cells, not pixels',
  blocks: [
    { kind: 'heading', level: 1, text: 'Cells' },
    { kind: 'paragraph', text: 'A widget claims whole cells.' },
    { kind: 'list', items: ['1x1', '2x2'] },
  ],
  evidenceRefs: ['wm/layout.ts'],
}
const VIDEO: VideoPayload = { kind: 'video', src: '/fixtures/test-pattern.mp4', poster: 'data:,', source: 'fixtures' }

beforeEach(() => {
  localStorage.clear()
  resetInboxForTests()
})

describe('media inbox', () => {
  it('starts empty', () => {
    expect(getMedia('video')).toBeNull()
    expect(getMedia('article')).toBeNull()
  })

  it('keeps one payload per kind, the newest winning', () => {
    putMedia(ARTICLE)
    putMedia(VIDEO)
    expect(getMedia('article')).toEqual(ARTICLE)
    expect(getMedia('video')).toEqual(VIDEO)
    const next = { ...ARTICLE, title: 'When space runs out' }
    putMedia(next)
    expect(getMedia('article')).toEqual(next)
    expect(getMedia('video')).toEqual(VIDEO)
  })

  it('tells subscribers, and stops when they leave', () => {
    const l = vi.fn()
    const off = subscribeMedia(l)
    putMedia(VIDEO)
    expect(l).toHaveBeenCalledTimes(1)
    off()
    putMedia(ARTICLE)
    expect(l).toHaveBeenCalledTimes(1)
  })

  it('re-renders the widget hook when a payload arrives', () => {
    const { result } = renderHook(() => useMedia('article'))
    expect(result.current).toBeNull()
    act(() => putMedia(ARTICLE))
    expect(result.current?.title).toBe('Cells, not pixels')
  })

  it('survives a reload', () => {
    putMedia(ARTICLE)
    putMedia(VIDEO)
    expect(loadInbox()).toEqual({ video: VIDEO, article: ARTICLE })
  })

  it('reads anything malformed as empty instead of crashing', () => {
    const cases = [
      'not json',
      '[]',
      'null',
      JSON.stringify({ video: { kind: 'video' }, article: { kind: 'article', title: 'x', blocks: 'no', evidenceRefs: [] } }),
      JSON.stringify({ video: { kind: 'image', src: 'a' }, article: { ...ARTICLE, blocks: [{ kind: 'heading', level: 9, text: 'x' }] } }),
      JSON.stringify({ video: { ...VIDEO, poster: 3 }, article: { ...ARTICLE, evidenceRefs: [1] } }),
    ]
    for (const raw of cases) {
      localStorage.setItem(INBOX_KEY, raw)
      expect(loadInbox()).toEqual({ video: null, article: null })
    }
  })

  it('keeps a good slot when only the other one is broken', () => {
    localStorage.setItem(INBOX_KEY, JSON.stringify({ video: VIDEO, article: { kind: 'article' } }))
    expect(loadInbox()).toEqual({ video: VIDEO, article: null })
  })

  it('showInWidget fills the slot and opens the matching widget', () => {
    const open = vi.fn(() => 'placed reader.')
    expect(showInWidget(ARTICLE, { open })).toBe('placed reader.')
    expect(open).toHaveBeenLastCalledWith('reader')
    expect(getMedia('article')).toEqual(ARTICLE)

    showInWidget(VIDEO, { open })
    expect(open).toHaveBeenLastCalledWith('video')
    expect(getMedia('video')).toEqual(VIDEO)
  })

  it('steps down to a smaller size when the desk is full, and keeps the payload either way', () => {
    // Only a 1x1 fits.
    const open = vi.fn((_id: string, size?: string) => (size === '1x1' ? 'placed video.' : 'no room for video. hide something first.'))
    expect(showInWidget(VIDEO, { open })).toBe('placed video.')
    expect(open.mock.calls).toEqual([['video'], ['video', '2x1'], ['video', '1x1']])

    const never = vi.fn(() => 'no room for reader. hide something first.')
    expect(showInWidget(ARTICLE, { open: never })).toBe('no room for reader. hide something first.')
    expect(never.mock.calls).toEqual([['reader'], ['reader', '1x2']])
    expect(getMedia('article')).toEqual(ARTICLE)
  })
})
