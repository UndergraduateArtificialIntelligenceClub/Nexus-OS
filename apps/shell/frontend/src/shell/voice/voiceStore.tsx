// Voice input state (issue #35): what the mic control shows, and the path from a spoken
// phrase to an agent run. Same external-store pattern as the agent and desktop stores.
//
//   idle ──start──▶ listening ──final──▶ preview ──submit──▶ submitting ──ok──▶ idle
//                      │ no speech / cancel ▲  │ Esc                 └─fails─▶ error(engine-unreachable)
//                      └──── error ─────────┘  ▼
//                                             idle
//
// The preview itself is Spotlight, prefilled with the transcript: Enter submits, Esc cancels.

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { createSpeechInput, type SpeechErrorKind, type SpeechInput, type SpeechInputHandlers } from './speechInput'

export type VoicePhase = 'idle' | 'listening' | 'preview' | 'submitting' | 'error'

/** Speech errors, plus the run failing after the transcript was ready. */
export type VoiceError = SpeechErrorKind | 'engine-unreachable'

export interface VoiceState {
  phase: VoicePhase
  /** Live text while listening. */
  interim: string
  /** The last finished transcript (kept after an engine failure so it can be retried). */
  transcript: string
  error: VoiceError | null
  /** False when the webview has no SpeechRecognition at all. */
  supported: boolean
}

export interface VoiceDeps {
  /** Turns the transcript into an agent run; resolves false when the run couldn't be made. */
  submit: (text: string) => Promise<boolean>
  /** A final transcript is ready: show the preview. */
  onTranscript: (text: string) => void
  /** Mirror listening onto the avatar (agent `listening` status). */
  onListeningChange?: (listening: boolean) => void
  /** Called right before listening starts: stop any reply being spoken (barge-in, #36). */
  beforeListen?: () => void
  /** For tests: build the recognizer wrapper. */
  createInput?: (handlers: SpeechInputHandlers) => SpeechInput
}

export type VoiceStore = ReturnType<typeof createVoiceStore>

export function createVoiceStore(deps: VoiceDeps) {
  const listeners = new Set<() => void>()
  let state: VoiceState
  /** The phrase is being dropped (Esc, or a new start), so its final result must be ignored. */
  let discard = false

  const set = (patch: Partial<VoiceState>) => {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  }

  const input = (deps.createInput ?? createSpeechInput)({
    onInterim: (interim) => set({ interim }),
    onFinal: (text) => {
      if (discard) return
      set({ phase: 'preview', transcript: text, interim: '' })
      deps.onTranscript(text)
    },
    onError: (error) => set({ phase: 'error', error, interim: '' }),
    onEnd: () => {
      deps.onListeningChange?.(false)
      // Nothing heard (or cancelled): back to idle. Errors and previews keep their phase.
      if (state.phase === 'listening') set({ phase: 'idle', interim: '' })
    },
  })

  state = { phase: 'idle', interim: '', transcript: '', error: null, supported: input.supported }

  /** Start listening. Allowed from idle and from an error (that is the "try again"). */
  const start = () => {
    if (state.phase !== 'idle' && state.phase !== 'error') return
    if (!input.supported) {
      set({ phase: 'error', error: 'unsupported' })
      return
    }
    discard = false
    deps.beforeListen?.()
    set({ phase: 'listening', interim: '', error: null })
    deps.onListeningChange?.(true)
    input.start()
  }

  /** Stop listening and take what was said (button press, push-to-talk release). */
  const stop = () => {
    if (state.phase === 'listening') input.stop()
  }

  const toggle = () => (state.phase === 'listening' ? stop() : start())

  /** Esc: drop the phrase, whatever stage it's at. Nothing is sent. */
  const cancel = () => {
    if (state.phase === 'submitting') return // already handed to the agent
    discard = true
    input.cancel()
    set({ phase: 'idle', interim: '', error: null })
  }

  /** Send the (possibly edited) transcript as a voice run. */
  const submit = async (text: string): Promise<boolean> => {
    const trimmed = text.trim()
    if (!trimmed || state.phase === 'submitting') return false
    set({ phase: 'submitting', transcript: trimmed, error: null })
    let ok = false
    try {
      ok = await deps.submit(trimmed)
    } catch {
      ok = false
    }
    set(ok ? { phase: 'idle' } : { phase: 'error', error: 'engine-unreachable' })
    return ok
  }

  /** After an engine failure: show the kept transcript in the preview again. */
  const retry = () => {
    if (state.error !== 'engine-unreachable' || !state.transcript) return
    set({ phase: 'preview', error: null })
    deps.onTranscript(state.transcript)
  }

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start,
    stop,
    toggle,
    cancel,
    submit,
    retry,
  }
}

// --- React binding ---

const VoiceContext = createContext<VoiceStore | null>(null)

export function VoiceProvider({ store, children }: { store: VoiceStore; children: ReactNode }) {
  return <VoiceContext.Provider value={store}>{children}</VoiceContext.Provider>
}

/** The voice store plus its current state (re-renders on every change). */
export function useVoice() {
  const store = useContext(VoiceContext)
  if (!store) throw new Error('useVoice must be used inside <VoiceProvider>')
  const state = useSyncExternalStore(store.subscribe, store.getState)
  return { state, store }
}
