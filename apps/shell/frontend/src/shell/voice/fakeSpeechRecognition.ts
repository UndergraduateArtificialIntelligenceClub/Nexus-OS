// A scriptable stand-in for the browser's SpeechRecognition, for tests (#35, and #37's
// mocked-edge voice loop). Tests drive it: emitStart → emitResult(...) → end().

import type { RecognitionErrorEvent, RecognitionLike, RecognitionResultEvent } from './speechInput'

type Handler<E> = ((event: E) => void) | null

export class FakeSpeechRecognition implements RecognitionLike {
  /** Every instance that start() was called on, oldest first. */
  static instances: FakeSpeechRecognition[] = []
  /** Make the next start() throw (some engines throw InvalidStateError). */
  static failNextStart: Error | null = null

  static get last(): FakeSpeechRecognition {
    const last = FakeSpeechRecognition.instances.at(-1)
    if (!last) throw new Error('no SpeechRecognition was started')
    return last
  }

  static reset() {
    FakeSpeechRecognition.instances = []
    FakeSpeechRecognition.failNextStart = null
  }

  lang = ''
  continuous = true
  interimResults = false
  maxAlternatives = 0
  onstart: Handler<Event> = null
  onaudiostart: Handler<Event> = null
  onresult: Handler<RecognitionResultEvent> = null
  onerror: Handler<RecognitionErrorEvent> = null
  onend: Handler<Event> = null

  started = false
  stopped = false
  aborted = false

  start() {
    const error = FakeSpeechRecognition.failNextStart
    if (error) {
      FakeSpeechRecognition.failNextStart = null
      throw error
    }
    this.started = true
    FakeSpeechRecognition.instances.push(this)
  }

  stop() {
    this.stopped = true
  }

  abort() {
    this.aborted = true
  }

  // --- drivers ---

  /** The engine accepted the session and opened the mic. */
  emitStart() {
    this.onstart?.(new Event('start'))
    this.onaudiostart?.(new Event('audiostart'))
  }

  /** Results so far: each segment is [text, isFinal]. A single string is one segment. */
  emitResult(segments: string | Array<[string, boolean]>, isFinal = false) {
    const list: Array<[string, boolean]> = typeof segments === 'string' ? [[segments, isFinal]] : segments
    const results = list.map(([transcript, final]) => Object.assign([{ transcript }], { isFinal: final }))
    this.onresult?.({ results })
  }

  emitError(error: string) {
    this.onerror?.({ error, message: '' })
  }

  end() {
    this.onend?.(new Event('end'))
  }

  /** The common happy path: start, interim text, final text, end. */
  say(text: string) {
    this.emitStart()
    this.emitResult(text.split(' ').slice(0, -1).join(' '))
    this.emitResult(text, true)
    this.end()
  }
}

/** Install the fake as window.webkitSpeechRecognition (what Chromium exposes). Returns the undo. */
export function installFakeSpeechRecognition(prop: 'webkitSpeechRecognition' | 'SpeechRecognition' = 'webkitSpeechRecognition') {
  const w = window as unknown as Record<string, unknown>
  const before = w[prop]
  FakeSpeechRecognition.reset()
  w[prop] = FakeSpeechRecognition
  return () => {
    if (before === undefined) delete w[prop]
    else w[prop] = before
    FakeSpeechRecognition.reset()
  }
}
