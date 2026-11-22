import { useSyncExternalStore } from 'react'
import type { DesktopCommands } from '@/ui'
import { SIZE_ORDER } from '@/wm/layout'
import { getApp } from './registry'
import type { WidgetPayload } from '@/types/agentEvents'

// The media inbox: what the video and reader widgets are showing. Anything that
// produces a typed payload drops it here and opens the widget. Today that's the
// browser's "open as widget" chip; later it's the engine's `run.response.widgets`,
// through the same `showInWidget`. One slot per kind: a new article replaces the
// last one, the way a reader app opens the page you tapped.
//
// It lives outside the desktop store on purpose: the desk's saved shape (signed
// off in #32) doesn't change, and the widgets stay plain apps of the registry.

export type VideoPayload = Extract<WidgetPayload, { kind: 'video' }>
export type ArticlePayload = Extract<WidgetPayload, { kind: 'article' }>
export type InboxKind = 'video' | 'article'
type PayloadOf<K extends InboxKind> = K extends 'video' ? VideoPayload : ArticlePayload

interface InboxState {
  video: VideoPayload | null
  article: ArticlePayload | null
}

export const INBOX_KEY = 'nexus-media-v1'

/** The widget that shows each kind. */
export const WIDGET_FOR = { video: 'video', article: 'reader' } as const

const isString = (v: unknown): v is string => typeof v === 'string'
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function isBlock(b: unknown): boolean {
  if (!isObject(b)) return false
  if (b.kind === 'heading') return (b.level === 1 || b.level === 2 || b.level === 3) && isString(b.text)
  if (b.kind === 'paragraph') return isString(b.text)
  if (b.kind === 'list') return Array.isArray(b.items) && b.items.every(isString)
  return false
}

function asVideo(v: unknown): VideoPayload | null {
  if (!isObject(v) || v.kind !== 'video' || !isString(v.src)) return null
  if ((v.poster !== undefined && !isString(v.poster)) || (v.source !== undefined && !isString(v.source))) return null
  return v as VideoPayload
}

function asArticle(v: unknown): ArticlePayload | null {
  if (!isObject(v) || v.kind !== 'article' || !isString(v.title)) return null
  if (!Array.isArray(v.blocks) || !v.blocks.every(isBlock)) return null
  if (!Array.isArray(v.evidenceRefs) || !v.evidenceRefs.every(isString)) return null
  return v as ArticlePayload
}

/** Reads the saved inbox. Anything malformed reads as empty, never as a crash. */
export function loadInbox(): InboxState {
  try {
    const raw = localStorage.getItem(INBOX_KEY)
    const saved: unknown = raw ? JSON.parse(raw) : null
    if (!isObject(saved)) return { video: null, article: null }
    return { video: asVideo(saved.video), article: asArticle(saved.article) }
  } catch {
    return { video: null, article: null }
  }
}

let state: InboxState = loadInbox()
const listeners = new Set<() => void>()

function save() {
  try {
    localStorage.setItem(INBOX_KEY, JSON.stringify(state))
  } catch {
    // Storage full or unavailable: the widget still shows it for this session.
  }
}

function emit() {
  for (const l of listeners) l()
}

/** Puts a payload in its slot, replacing what was there. */
export function putMedia(payload: VideoPayload | ArticlePayload) {
  state = payload.kind === 'video' ? { ...state, video: payload } : { ...state, article: payload }
  save()
  emit()
}

export function getMedia<K extends InboxKind>(kind: K): PayloadOf<K> | null {
  return state[kind] as PayloadOf<K> | null
}

export function subscribeMedia(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The payload a widget shows, re-rendering when a new one arrives. */
export function useMedia<K extends InboxKind>(kind: K): PayloadOf<K> | null {
  return useSyncExternalStore(subscribeMedia, () => getMedia(kind))
}

/**
 * The one entry point: show this payload in its widget. Opens the widget (or
 * brings it back from the dock) and answers with the desk's reply string. A
 * full desk gets the widget at a smaller size it declares before it gets a no;
 * either way the payload is kept, so it's there once room is made.
 */
export function showInWidget(payload: VideoPayload | ArticlePayload, commands: Pick<DesktopCommands, 'open'>): string {
  putMedia(payload)
  const id = WIDGET_FOR[payload.kind]
  const first = commands.open(id)
  if (!first.startsWith('no room')) return first
  const { sizes, defaultSize } = getApp(id)
  const smaller = sizes.filter((s) => SIZE_ORDER.indexOf(s) < SIZE_ORDER.indexOf(defaultSize)).sort((a, b) => SIZE_ORDER.indexOf(b) - SIZE_ORDER.indexOf(a))
  for (const size of smaller) {
    const reply = commands.open(id, size)
    if (!reply.startsWith('no room')) return reply
  }
  return first
}

/** Tests only: start over from whatever storage holds now. */
export function resetInboxForTests() {
  state = loadInbox()
  emit()
}
