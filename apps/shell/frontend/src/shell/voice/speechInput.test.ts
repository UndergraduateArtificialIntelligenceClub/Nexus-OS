import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSpeechRecognition, installFakeSpeechRecognition } from './fakeSpeechRecognition'
import {
  START_TIMEOUT_MS,
  STOP_TIMEOUT_MS,
  createSpeechInput,
  getRecognition,
  mapRecognitionError,
  type SpeechInputHandlers,
} from './speechInput'

// The Web Speech wrapper (#35): session lifecycle, error mapping, and the watchdogs for
// engines that never answer.

let uninstall: () => void

beforeEach(() => {
  uninstall = installFakeSpeechRecognition()
})

afterEach(() => {
  uninstall()
  vi.useRealTimers()
})

function handlers() {
  const calls: string[] = []
  const h: Required<SpeechInputHandlers> = {
    onStart: vi.fn(() => calls.push('start')),
    onInterim: vi.fn((t: string) => calls.push(`interim:${t}`)),
    onFinal: vi.fn((t: string) => calls.push(`final:${t}`)),
    onError: vi.fn((k: string) => calls.push(`error:${k}`)),
    onEnd: vi.fn(() => calls.push('end')),
  }
  return { h, calls }
}

describe('support', () => {
  it('finds webkitSpeechRecognition or SpeechRecognition', () => {
    expect(getRecognition()).toBe(FakeSpeechRecognition)
    expect(getRecognition({ SpeechRecognition: FakeSpeechRecognition })).toBe(FakeSpeechRecognition)
    expect(getRecognition({})).toBeNull()
  })

  it('reports unsupported when the webview has no recognizer', () => {
    const { h, calls } = handlers()
    const input = createSpeechInput(h, { Recognition: null })
    expect(input.supported).toBe(false)
    input.start()
    expect(calls).toEqual(['error:unsupported', 'end'])
    expect(input.listening).toBe(false)
  })
})

describe('a session', () => {
  it('configures the recognizer for one short phrase with interim results', () => {
    const input = createSpeechInput(handlers().h)
    input.start()
    const rec = FakeSpeechRecognition.last
    expect(rec).toMatchObject({ lang: 'en-US', continuous: false, interimResults: true, maxAlternatives: 1 })
    expect(input.listening).toBe(true)
  })

  it('streams interim text, then delivers the final transcript once', () => {
    const { h, calls } = handlers()
    const input = createSpeechInput(h)
    input.start()
    FakeSpeechRecognition.last.say('open the browser')
    expect(calls).toEqual(['start', 'interim:open the', 'interim:open the browser', 'final:open the browser', 'end'])
    expect(input.listening).toBe(false)
  })

  it('joins segments and tidies whitespace', () => {
    const { h } = handlers()
    createSpeechInput(h).start()
    const rec = FakeSpeechRecognition.last
    rec.emitStart()
    rec.emitResult([
      [' open  the', true],
      [' browser ', true],
    ])
    rec.end()
    expect(h.onFinal).toHaveBeenCalledWith('open the browser')
  })

  it('falls back to the interim text when the engine ends without a final result', () => {
    const { h } = handlers()
    const input = createSpeechInput(h)
    input.start()
    const rec = FakeSpeechRecognition.last
    rec.emitStart()
    rec.emitResult('minimize the notes')
    input.stop()
    expect(rec.stopped).toBe(true)
    rec.end()
    expect(h.onFinal).toHaveBeenCalledWith('minimize the notes')
  })

  it('does not call onFinal when nothing was heard', () => {
    const { h, calls } = handlers()
    createSpeechInput(h).start()
    const rec = FakeSpeechRecognition.last
    rec.emitStart()
    rec.emitError('no-speech')
    rec.end()
    expect(calls).toEqual(['start', 'end'])
  })

  it('ignores start() while a session is running', () => {
    const input = createSpeechInput(handlers().h)
    input.start()
    input.start()
    expect(FakeSpeechRecognition.instances).toHaveLength(1)
  })

  it('cancel aborts without a transcript and ignores late engine events', () => {
    const { h, calls } = handlers()
    const input = createSpeechInput(h)
    input.start()
    const rec = FakeSpeechRecognition.last
    rec.emitStart()
    rec.emitResult('open the')
    input.cancel()
    expect(rec.aborted).toBe(true)
    rec.emitResult('open the browser', true)
    rec.end()
    expect(h.onFinal).not.toHaveBeenCalled()
    expect(calls.filter((c) => c === 'end')).toHaveLength(1)
  })

  it('starts a fresh recognizer for every session', () => {
    const input = createSpeechInput(handlers().h)
    input.start()
    FakeSpeechRecognition.last.say('one')
    input.start()
    FakeSpeechRecognition.last.say('two')
    expect(FakeSpeechRecognition.instances).toHaveLength(2)
  })
})

describe('errors', () => {
  it.each([
    ['not-allowed', 'permission-denied'],
    ['service-not-allowed', 'permission-denied'],
    ['audio-capture', 'mic-unavailable'],
    ['network', 'service-unreachable'],
    ['language-not-supported', 'unsupported'],
    ['something-new', 'service-unreachable'],
  ])('maps %s to %s', (code, kind) => {
    expect(mapRecognitionError(code)).toBe(kind)
  })

  it.each(['no-speech', 'aborted'])('treats %s as no error', (code) => {
    expect(mapRecognitionError(code)).toBeNull()
  })

  it('reports an error once and never delivers a transcript after it', () => {
    const { h, calls } = handlers()
    createSpeechInput(h).start()
    const rec = FakeSpeechRecognition.last
    rec.emitStart()
    rec.emitResult('open the')
    rec.emitError('network')
    rec.emitError('network')
    rec.end()
    expect(calls).toEqual(['start', 'interim:open the', 'error:service-unreachable', 'end'])
  })

  it('reports permission-denied (the user blocked the mic)', () => {
    const { h, calls } = handlers()
    createSpeechInput(h).start()
    FakeSpeechRecognition.last.emitError('not-allowed')
    FakeSpeechRecognition.last.end()
    expect(calls).toEqual(['error:permission-denied', 'end'])
  })

  it('treats a throwing start() as the service being unreachable', () => {
    const { h, calls } = handlers()
    FakeSpeechRecognition.failNextStart = new Error('InvalidStateError')
    const input = createSpeechInput(h)
    input.start()
    expect(calls).toEqual(['error:service-unreachable', 'end'])
    expect(input.listening).toBe(false)
  })
})

describe('watchdogs', () => {
  it('gives up when the engine never starts (WebView2 network failures)', () => {
    vi.useFakeTimers()
    const { h, calls } = handlers()
    const input = createSpeechInput(h)
    input.start()
    vi.advanceTimersByTime(START_TIMEOUT_MS - 1)
    expect(calls).toEqual([])
    vi.advanceTimersByTime(1)
    expect(calls).toEqual(['error:service-unreachable', 'end'])
    expect(FakeSpeechRecognition.last.aborted).toBe(true)
    expect(input.listening).toBe(false)
  })

  it('does not fire once the engine has started, even in a long silence', () => {
    vi.useFakeTimers()
    const { h } = handlers()
    createSpeechInput(h).start()
    FakeSpeechRecognition.last.emitStart()
    vi.advanceTimersByTime(START_TIMEOUT_MS * 3)
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('delivers what it has when the engine never ends after stop()', () => {
    vi.useFakeTimers()
    const { h, calls } = handlers()
    const input = createSpeechInput(h)
    input.start()
    const rec = FakeSpeechRecognition.last
    rec.emitStart()
    rec.emitResult('tidy up my desktop')
    input.stop()
    vi.advanceTimersByTime(STOP_TIMEOUT_MS)
    expect(calls.slice(-2)).toEqual(['final:tidy up my desktop', 'end'])
    expect(rec.aborted).toBe(true)
  })
})
