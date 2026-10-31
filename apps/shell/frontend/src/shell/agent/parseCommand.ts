// Stand-in for the real agent: keyword matching only, no backend call.
// Stays as the offline fallback once the engine's agent is connected.

import { APP_IDS, getApp, type AppId } from '@/apps/registry'
import type { SizeRequest } from '@/wm/desktopStore'

export type Command =
  | { type: 'open'; appId: AppId; size?: SizeRequest }
  | { type: 'close'; appId: AppId }
  | { type: 'resize'; appId: AppId; size: SizeRequest }
  | { type: 'closeAll' }
  | { type: 'tidy' }
  | { type: 'theme'; theme: 'light' | 'dark' | 'toggle' }
  | { type: 'help' }
  | { type: 'unknown' }

const has = (text: string, words: string[]) => words.some((w) => new RegExp(`\\b${w}\\b`).test(text))

function findApp(text: string): AppId | undefined {
  return APP_IDS.find((id) => has(text, getApp(id).aliases))
}

function findSize(text: string): SizeRequest | undefined {
  if (has(text, ['bigger', 'larger', 'grow', 'expand'])) return 'up'
  if (has(text, ['smaller', 'shrink'])) return 'down'
  if (has(text, ['small', 'tiny', 'compact', '1x1'])) return '1x1'
  if (has(text, ['panorama', 'widest', '4x2']) || text.includes('extra wide')) return '4x2'
  if (has(text, ['tall', '1x2'])) return '1x2'
  if (has(text, ['medium', 'wide', '2x1'])) return '2x1'
  if (has(text, ['large', 'big', 'huge', '2x2'])) return '2x2'
  return undefined
}

export function parseCommand(input: string): Command {
  const text = input.toLowerCase().trim()
  const appId = findApp(text)
  const size = findSize(text)

  if (has(text, ['help']) || text.includes('what can you do')) return { type: 'help' }
  if (!appId) {
    if (has(text, ['dark'])) return { type: 'theme', theme: 'dark' }
    if (has(text, ['light'])) return { type: 'theme', theme: 'light' }
    if (has(text, ['theme'])) return { type: 'theme', theme: 'toggle' }
  }
  if (has(text, ['tidy', 'arrange', 'rearrange', 'organize', 'organise']) || text.includes('clean up'))
    return { type: 'tidy' }
  if (has(text, ['hide', 'close', 'remove', 'dismiss', 'clear'])) {
    if (has(text, ['all', 'everything']) || text === 'clear') return { type: 'closeAll' }
    if (appId) return { type: 'close', appId }
  }
  if (appId && size && has(text, ['make', 'resize', 'set', 'bigger', 'smaller', 'larger', 'grow', 'shrink', 'expand']))
    return { type: 'resize', appId, size }
  if (appId) return { type: 'open', appId, size }
  return { type: 'unknown' }
}
