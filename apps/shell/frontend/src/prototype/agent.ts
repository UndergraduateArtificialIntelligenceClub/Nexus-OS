// Stand-in for the real agent: keyword matching only, no backend call.

import type { Size } from './layout'
import { KINDS, WIDGETS, type Kind } from './widgets'

export type SizeRequest = Size | 'up' | 'down'

export type Command =
  | { type: 'show'; kind: Kind; size?: SizeRequest }
  | { type: 'hide'; kind: Kind }
  | { type: 'resize'; kind: Kind; size: SizeRequest }
  | { type: 'hideAll' }
  | { type: 'tidy' }
  | { type: 'theme'; theme: 'light' | 'dark' | 'toggle' }
  | { type: 'help' }
  | { type: 'unknown' }

const has = (text: string, words: string[]) => words.some((w) => new RegExp(`\\b${w}\\b`).test(text))

function findKind(text: string): Kind | undefined {
  return KINDS.find((k) => has(text, WIDGETS[k].aliases))
}

function findSize(text: string): SizeRequest | undefined {
  if (has(text, ['bigger', 'larger', 'grow', 'expand'])) return 'up'
  if (has(text, ['smaller', 'shrink'])) return 'down'
  if (has(text, ['small', 'tiny', 'compact', '1x1'])) return '1x1'
  if (has(text, ['medium', 'wide', '2x1'])) return '2x1'
  if (has(text, ['large', 'big', 'huge', '2x2'])) return '2x2'
  return undefined
}

export function parseCommand(input: string): Command {
  const text = input.toLowerCase().trim()
  const kind = findKind(text)
  const size = findSize(text)

  if (has(text, ['help']) || text.includes('what can you do')) return { type: 'help' }
  if (!kind) {
    if (has(text, ['dark'])) return { type: 'theme', theme: 'dark' }
    if (has(text, ['light'])) return { type: 'theme', theme: 'light' }
    if (has(text, ['theme'])) return { type: 'theme', theme: 'toggle' }
  }
  if (has(text, ['tidy', 'arrange', 'rearrange', 'organize', 'organise']) || text.includes('clean up'))
    return { type: 'tidy' }
  if (has(text, ['hide', 'close', 'remove', 'dismiss', 'clear'])) {
    if (has(text, ['all', 'everything']) || text === 'clear') return { type: 'hideAll' }
    if (kind) return { type: 'hide', kind }
  }
  if (kind && size && has(text, ['make', 'resize', 'set', 'bigger', 'smaller', 'larger', 'grow', 'shrink', 'expand']))
    return { type: 'resize', kind, size }
  if (kind) return { type: 'show', kind, size }
  return { type: 'unknown' }
}
