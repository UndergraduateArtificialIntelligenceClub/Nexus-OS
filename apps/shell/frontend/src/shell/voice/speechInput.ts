// Speech-to-text through the browser's Web Speech API (issue #35; decision in docs/voice/decision.md).
//
// The rest of the shell never touches SpeechRecognition directly: this wrapper owns one
// recognition session at a time, maps the engine's error codes onto the states the mic
// control shows, and guards against engines that never answer (WebView2 Runtime 153 fails
// with `network`, sometimes without firing `end`). Swap the recognizer here and nothing
// else changes.
//
// Privacy: Nexus only ever forwards the transcript. The recognizer itself is the webview's,
// and Chromium's streams the mic audio to its vendor's speech service (Microsoft in
// WebView2/Edge, Google in Chrome). See 07-api-flow.md, "Voice".

/** Why voice input can't be used right now. Each one is shown explicitly by the mic control. */
export type SpeechErrorKind =
  /** No SpeechRecognition in this webview, or it doesn't support the language. */
  | 'unsupported'
  /** The user or the OS blocked the microphone. */
  | 'permission-denied'
  /** No microphone, or it couldn't be opened. */
  | 'mic-unavailable'
  /** The vendor's speech service didn't answer (`network`, or no response at all). */
  | 'service-unreachable'

/** The subset of SpeechRecognition we use. Declared here so no global DOM types are needed. */
export interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: ((event: Event) => void) | null
  onaudiostart: ((event: Event) => void) | null
  onresult: ((event: RecognitionResultEvent) => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
  onend: ((event: Event) => void) | null
  start(): void
  stop(): void
  abort(): void
}

export interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

export interface RecognitionErrorEvent {
  error: string
  message?: string
}

export type RecognitionCtor = new () => RecognitionLike

/** The webview's recognizer, or null when it has none. */
export function getRecognition(win: unknown = typeof window === 'undefined' ? undefined : window): RecognitionCtor | null {
  const w = win as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor } | undefined
  return w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null
}

/** Engine error code → what the user sees. Null means "not an error": just go back to idle. */
export function mapRecognitionError(code: string): SpeechErrorKind | null {
  switch (code) {
    case 'no-speech':
    case 'aborted':
      return null
    case 'not-allowed':
    case 'service-not-allowed':
      return 'permission-denied'
    case 'audio-capture':
      return 'mic-unavailable'
    case 'language-not-supported':
    case 'bad-grammar':
      return 'unsupported'
    case 'network':
    default:
      return 'service-unreachable'
  }
}

export interface SpeechInputHandlers {
  /** Recognition really started (the engine accepted the session). */
  onStart?: () => void
  /** The best guess so far, updated while the user talks. */
  onInterim?: (text: string) => void
  /** The finished transcript. Not called for empty results, errors or cancel. */
  onFinal?: (text: string) => void
  onError?: (kind: SpeechErrorKind, detail?: string) => void
  /** The session is over, whichever way it ended. Always the last call. */
  onEnd?: () => void
}

export interface SpeechInputOptions {
  lang?: string
  /** Defaults to the webview's own; pass null to simulate "unsupported", or a fake in tests. */
  Recognition?: RecognitionCtor | null
  /** Give up if the engine hasn't started this long after start(). */
  startTimeoutMs?: number
  /** Give up waiting for the final result this long after stop(). */
  stopTimeoutMs?: number
}

export interface SpeechInput {
  readonly supported: boolean
  readonly listening: boolean
  /** Begin a session. A no-op while one is running. */
  start(): void
  /** Stop listening and deliver the final transcript (push-to-talk release). */
  stop(): void
  /** Abort: no transcript, no error. */
  cancel(): void
}

export const START_TIMEOUT_MS = 5000
export const STOP_TIMEOUT_MS = 4000

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

export function createSpeechInput(handlers: SpeechInputHandlers, options: SpeechInputOptions = {}): SpeechInput {
  const Recognition = options.Recognition === undefined ? getRecognition() : options.Recognition
  const lang = options.lang ?? 'en-US'
  const startTimeoutMs = options.startTimeoutMs ?? START_TIMEOUT_MS
  const stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS

  /** One recognition session. Events from a finished session are ignored. */
  interface Session {
    rec: RecognitionLike
    finalText: string
    interim: string
    started: boolean
    failed: boolean
    timer: ReturnType<typeof setTimeout> | null
  }
  let session: Session | null = null

  const clearTimer = (s: Session) => {
    if (s.timer !== null) clearTimeout(s.timer)
    s.timer = null
  }

  /** End a session exactly once, detaching it so late engine events do nothing. */
  const finish = (s: Session, deliver: boolean) => {
    if (session !== s) return
    session = null
    clearTimer(s)
    s.rec.onstart = s.rec.onaudiostart = s.rec.onresult = s.rec.onerror = s.rec.onend = null
    const text = clean(s.finalText || s.interim)
    if (deliver && !s.failed && text) handlers.onFinal?.(text)
    handlers.onEnd?.()
  }

  const fail = (s: Session, kind: SpeechErrorKind, detail?: string) => {
    if (session !== s || s.failed) return
    s.failed = true
    handlers.onError?.(kind, detail)
  }

  return {
    get supported() {
      return Recognition !== null
    },
    get listening() {
      return session !== null
    },

    start() {
      if (session) return
      if (!Recognition) {
        handlers.onError?.('unsupported')
        handlers.onEnd?.()
        return
      }
      const rec = new Recognition()
      rec.lang = lang
      rec.continuous = false
      rec.interimResults = true
      rec.maxAlternatives = 1
      const s: Session = { rec, finalText: '', interim: '', started: false, failed: false, timer: null }
      session = s

      const markStarted = () => {
        if (s.started || session !== s) return
        s.started = true
        clearTimer(s)
        handlers.onStart?.()
      }
      rec.onstart = markStarted
      rec.onaudiostart = markStarted
      rec.onresult = (event) => {
        if (session !== s) return
        markStarted()
        let finalText = ''
        let interim = ''
        for (const result of Array.from(event.results)) {
          const transcript = result[0]?.transcript ?? ''
          if (result.isFinal) finalText += ` ${transcript}`
          else interim += ` ${transcript}`
        }
        s.finalText = clean(finalText)
        s.interim = clean(`${finalText} ${interim}`)
        handlers.onInterim?.(s.interim)
      }
      rec.onerror = (event) => {
        const kind = mapRecognitionError(event.error)
        if (kind) fail(s, kind, event.error)
      }
      rec.onend = () => finish(s, true)

      // Some engines accept start() and then never answer: treat that as the service being down.
      s.timer = setTimeout(() => {
        if (s.started) return
        fail(s, 'service-unreachable', 'no response from the speech service')
        rec.abort()
        finish(s, false)
      }, startTimeoutMs)

      try {
        rec.start()
      } catch (error) {
        fail(s, 'service-unreachable', String(error))
        finish(s, false)
      }
    },

    stop() {
      const s = session
      if (!s) return
      clearTimer(s)
      // Deliver what we have if the engine never sends `end` after stop().
      s.timer = setTimeout(() => {
        s.rec.abort()
        finish(s, true)
      }, stopTimeoutMs)
      try {
        s.rec.stop()
      } catch {
        finish(s, true)
      }
    },

    cancel() {
      const s = session
      if (!s) return
      try {
        s.rec.abort()
      } catch {
        /* already stopped */
      }
      finish(s, false)
    },
  }
}
