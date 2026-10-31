import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AppId } from '@/apps/registry'
import type { Size } from '@/wm/layout'
import { useDesktop } from '@/wm/desktopStore'
import { Tray } from './Tray'

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
const REPLY_MS = 6000

type TrayState = 'closed' | 'open' | 'closing'

interface PromptBarProps {
  /** Runs a typed request and returns the agent's reply. */
  onAsk: (text: string) => string
  themeLabel: string
  onToggleTheme: () => string
}

/**
 * The quiet agent prompt, its reply line, and keyboard hints.
 * Keys: ⌘/Ctrl+K app tray, "/" to ask, Esc to close.
 * Interim: Spotlight, the Dock and the avatar's bubble replace this in the next step.
 */
export function PromptBar({ onAsk, themeLabel, onToggleTheme }: PromptBarProps) {
  const { store } = useDesktop()
  const [input, setInput] = useState('')
  const [reply, setReply] = useState('')
  const [tray, setTray] = useState<TrayState>('closed')
  const inputRef = useRef<HTMLInputElement>(null)

  // Ignore presses while the tray is still un-drawing.
  const toggleTray = () => setTray((s) => (s === 'closed' ? 'open' : 'closing'))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggleTray()
      } else if (e.key === 'Escape') {
        setTray((s) => (s === 'open' ? 'closing' : s))
        inputRef.current?.blur()
      } else if (e.key === '/' && !isTypingTarget(e.target)) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Replies fade out on their own.
  useEffect(() => {
    if (!reply) return
    const id = window.setTimeout(() => setReply(''), REPLY_MS)
    return () => window.clearTimeout(id)
  }, [reply])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    setReply(onAsk(input))
    setInput('')
  }

  return (
    <footer className="nx-prompt-bar">
      {tray !== 'closed' && (
        <Tray
          phase={tray === 'open' ? 'enter' : 'exit'}
          onPick={(appId: AppId, size?: Size) => setReply(store.open(appId, size))}
          onHide={(appId: AppId) => setReply(store.close(appId))}
          onClosed={() => setTray('closed')}
        />
      )}
      <form className="nx-prompt" onSubmit={onSubmit}>
        <label htmlFor="nx-ask" className="sr-only">
          Ask Nexus
        </label>
        <span className="nx-prompt-mark" aria-hidden="true">
          &gt;
        </span>
        <input
          id="nx-ask"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='ask nexus, e.g. "show terminal"'
          autoComplete="off"
          spellCheck={false}
        />
      </form>
      <p className="nx-reply" aria-live="polite">
        {reply}
      </p>
      <p className="nx-hint">
        <button type="button" className="nx-hint-btn" onClick={toggleTray}>
          <kbd>{IS_MAC ? '⌘' : 'Ctrl'}</kbd>
          <kbd>K</kbd> apps
        </button>
        <span aria-hidden="true">·</span>
        <span>
          <kbd>/</kbd> ask
        </span>
        <span aria-hidden="true">·</span>
        <button type="button" className="nx-hint-btn" onClick={() => setReply(onToggleTheme())}>
          {themeLabel}
        </button>
      </p>
    </footer>
  )
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))
}
