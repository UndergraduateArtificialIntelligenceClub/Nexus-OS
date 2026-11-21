import { useEffect } from 'react'
import { useVoice, type VoiceError, type VoicePhase, type VoiceStore } from '../voice/voiceStore'

// Same test as MenuBar's IS_MAC; not imported from there because MenuBar imports this file.
const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

/** Shown in every tooltip: what leaves the machine when you talk (07-api-flow.md, "Voice"). */
export const PRIVACY_NOTE =
  "Nexus sends only the transcript. Your webview's speech service (Microsoft or Google) hears the audio."

export const PTT_LABEL = IS_MAC ? '⌘⇧Space' : 'Ctrl+Shift+Space'

const LABELS: Record<Exclude<VoicePhase, 'error'>, string> = {
  idle: 'mic',
  listening: 'listening',
  preview: 'review',
  submitting: 'sending',
}

const ERROR_LABELS: Record<VoiceError, string> = {
  unsupported: 'voice unsupported',
  'permission-denied': 'mic blocked',
  'mic-unavailable': 'no mic',
  'service-unreachable': 'voice offline',
  'engine-unreachable': 'engine offline',
}

const ERROR_HINTS: Record<VoiceError, string> = {
  unsupported: 'This webview has no speech recognition. Type instead.',
  'permission-denied': 'Microphone access is blocked. Allow it in your system or browser settings, then click to try again.',
  'mic-unavailable': 'No microphone was found or it could not be opened. Click to try again.',
  'service-unreachable': "The speech service didn't answer. Check your connection, then click to try again.",
  'engine-unreachable': "The transcript is ready but the agent couldn't be reached. Click to review and send it again.",
}

/** The newest words, so a long phrase doesn't push the menu bar around. */
export const tail = (text: string, max = 40) => (text.length > max ? `…${text.slice(-(max - 1))}` : text)

export function micLabel(phase: VoicePhase, error: VoiceError | null): string {
  return phase === 'error' && error ? ERROR_LABELS[error] : LABELS[phase === 'error' ? 'idle' : phase]
}

function micHint(phase: VoicePhase, error: VoiceError | null): string {
  if (phase === 'error' && error) return ERROR_HINTS[error]
  if (phase === 'listening') return 'Listening. Click or release the keys to finish, Esc to cancel.'
  return `Talk to Nexus: click, or hold ${PTT_LABEL}.`
}

/**
 * The mic in the menu bar. Click toggles listening; holding the push-to-talk keys listens
 * until they're released. While listening, the words so far appear beside it.
 */
export function MicButton() {
  const { state, store } = useVoice()
  const { phase, error, interim, supported } = state
  const label = micLabel(phase, error)
  const title = `${micHint(phase, error)}\n${PRIVACY_NOTE}`

  if (!supported) {
    return (
      <span className="nx-menubar-item nx-mic" data-error="unsupported" title={title}>
        {ERROR_LABELS.unsupported}
      </span>
    )
  }

  const onClick = () => {
    if (phase === 'error' && error === 'engine-unreachable') store.retry()
    else store.toggle()
  }

  return (
    <span className="nx-mic-wrap">
      {phase === 'listening' && (
        <span className="nx-mic-interim" aria-live="polite">
          {tail(interim)}
        </span>
      )}
      <button
        type="button"
        className="nx-menubar-btn nx-press nx-mic"
        data-mic-origin
        data-phase={phase}
        data-error={error ?? undefined}
        aria-pressed={phase === 'listening'}
        aria-keyshortcuts={IS_MAC ? 'Meta+Shift+Space' : 'Control+Shift+Space'}
        disabled={phase === 'preview' || phase === 'submitting'}
        title={title}
        onClick={onClick}
      >
        <span className="nx-mic-dot" aria-hidden="true" />
        {label}
      </button>
    </span>
  )
}

const isPttCombo = (e: KeyboardEvent) => e.code === 'Space' && e.shiftKey && (IS_MAC ? e.metaKey : e.ctrlKey)

/**
 * Push-to-talk: hold Mod+Shift+Space to listen, release to finish. Esc cancels listening or
 * clears a voice error. Runs in the capture phase so a consumed Esc doesn't also reach the
 * desktop's own Escape handling (exit fullscreen).
 */
export function usePushToTalk(voice: VoiceStore, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    let holding = false

    const onKeyDown = (e: KeyboardEvent) => {
      if (isPttCombo(e)) {
        e.preventDefault()
        if (e.repeat || holding) return
        holding = true
        voice.start()
        return
      }
      if (e.key === 'Escape') {
        const { phase } = voice.getState()
        if (phase === 'listening' || phase === 'error') {
          e.preventDefault()
          e.stopPropagation()
          holding = false
          voice.cancel()
        }
      }
    }
    // Letting go of Space or of a modifier ends the hold.
    const onKeyUp = (e: KeyboardEvent) => {
      if (!holding) return
      if (e.code === 'Space' || e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control') {
        holding = false
        voice.stop()
      }
    }
    // Switching windows mid-hold never delivers the keyup.
    const onBlur = () => {
      if (!holding) return
      holding = false
      voice.stop()
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [voice, enabled])
}
