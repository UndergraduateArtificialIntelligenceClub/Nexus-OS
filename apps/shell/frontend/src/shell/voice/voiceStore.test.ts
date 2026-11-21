import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSpeechRecognition, installFakeSpeechRecognition } from './fakeSpeechRecognition'
import { createSpeechInput } from './speechInput'
import { createVoiceStore, type VoiceDeps } from './voiceStore'

// Voice input state (#35): listening → preview → submit, cancel, and each error state.

let uninstall: () => void

beforeEach(() => {
  uninstall = installFakeSpeechRecognition()
})

afterEach(() => uninstall())

function setup(overrides: Partial<Omit<VoiceDeps, 'onTranscript'>> = {}) {
  const deps = {
    submit: vi.fn(async (_text: string) => true),
    onTranscript: vi.fn<(text: string) => void>(),
    onListeningChange: vi.fn(),
    beforeListen: vi.fn(),
    ...overrides,
  }
  const voice = createVoiceStore(deps)
  return { voice, deps }
}

describe('speak, review, send', () => {
  it('listens, shows the transcript for review, then submits it as a voice run', async () => {
    const { voice, deps } = setup()
    expect(voice.getState()).toMatchObject({ phase: 'idle', supported: true })

    voice.start()
    expect(voice.getState().phase).toBe('listening')
    expect(deps.onListeningChange).toHaveBeenLastCalledWith(true)

    const rec = FakeSpeechRecognition.last
    rec.emitStart()
    rec.emitResult('open the')
    expect(voice.getState().interim).toBe('open the')

    rec.emitResult('open the browser', true)
    rec.end()
    expect(voice.getState()).toMatchObject({ phase: 'preview', transcript: 'open the browser', interim: '' })
    expect(deps.onTranscript).toHaveBeenCalledWith('open the browser')
    expect(deps.onListeningChange).toHaveBeenLastCalledWith(false)
    expect(deps.submit).not.toHaveBeenCalled() // nothing is sent before review

    await expect(voice.submit('open the browser')).resolves.toBe(true)
    expect(deps.submit).toHaveBeenCalledWith('open the browser')
    expect(voice.getState().phase).toBe('idle')
  })

  it('sends the edited text, not the raw transcript', async () => {
    const { voice, deps } = setup()
    voice.start()
    FakeSpeechRecognition.last.say('open the browse')
    await voice.submit('  open the browser ')
    expect(deps.submit).toHaveBeenCalledWith('open the browser')
  })

  it('is "submitting" while the run is being made, and ignores a second submit', async () => {
    let finish!: (ok: boolean) => void
    const { voice, deps } = setup({ submit: vi.fn(() => new Promise<boolean>((r) => (finish = r))) })
    voice.start()
    FakeSpeechRecognition.last.say('tidy up')
    const first = voice.submit('tidy up')
    expect(voice.getState().phase).toBe('submitting')
    await expect(voice.submit('tidy up')).resolves.toBe(false)
    finish(true)
    await first
    expect(deps.submit).toHaveBeenCalledTimes(1)
    expect(voice.getState().phase).toBe('idle')
  })

  it('stops any reply being spoken before it listens (barge-in hook)', () => {
    const { voice, deps } = setup()
    voice.start()
    expect(deps.beforeListen).toHaveBeenCalledTimes(1)
  })

  it('toggle starts and then stops listening', () => {
    const { voice } = setup()
    voice.toggle()
    expect(voice.getState().phase).toBe('listening')
    voice.toggle()
    expect(FakeSpeechRecognition.last.stopped).toBe(true)
  })

  it('goes back to idle when nothing was said', () => {
    const { voice, deps } = setup()
    voice.start()
    const rec = FakeSpeechRecognition.last
    rec.emitStart()
    rec.emitError('no-speech')
    rec.end()
    expect(voice.getState()).toMatchObject({ phase: 'idle', error: null })
    expect(deps.onTranscript).not.toHaveBeenCalled()
  })

  it('does not start a new phrase while one is being reviewed', () => {
    const { voice } = setup()
    voice.start()
    FakeSpeechRecognition.last.say('open notes')
    voice.start()
    expect(FakeSpeechRecognition.instances).toHaveLength(1)
    expect(voice.getState().phase).toBe('preview')
  })
})

describe('Esc cancels', () => {
  it('while listening: aborts, sends nothing, ignores the late final result', () => {
    const { voice, deps } = setup()
    voice.start()
    const rec = FakeSpeechRecognition.last
    rec.emitStart()
    rec.emitResult('close the')
    voice.cancel()
    expect(rec.aborted).toBe(true)
    rec.emitResult('close the clock', true)
    rec.end()
    expect(voice.getState()).toMatchObject({ phase: 'idle', interim: '' })
    expect(deps.onTranscript).not.toHaveBeenCalled()
    expect(deps.submit).not.toHaveBeenCalled()
    expect(deps.onListeningChange).toHaveBeenLastCalledWith(false)
  })

  it('in the preview: drops the phrase, nothing is sent', () => {
    const { voice, deps } = setup()
    voice.start()
    FakeSpeechRecognition.last.say('close the clock')
    voice.cancel()
    expect(voice.getState().phase).toBe('idle')
    expect(deps.submit).not.toHaveBeenCalled()
  })

  it('clears an error', () => {
    const { voice } = setup()
    voice.start()
    FakeSpeechRecognition.last.emitError('not-allowed')
    voice.cancel()
    expect(voice.getState()).toMatchObject({ phase: 'idle', error: null })
  })
})

describe('error states', () => {
  it('unsupported: no recognizer in this webview', () => {
    const { voice, deps } = setup({ createInput: (h) => createSpeechInput(h, { Recognition: null }) })
    expect(voice.getState().supported).toBe(false)
    voice.start()
    expect(voice.getState()).toMatchObject({ phase: 'error', error: 'unsupported' })
    expect(deps.onListeningChange).not.toHaveBeenCalledWith(true)
  })

  it.each([
    ['not-allowed', 'permission-denied'],
    ['audio-capture', 'mic-unavailable'],
    ['network', 'service-unreachable'],
  ])('%s from the recognizer shows %s', (code, error) => {
    const { voice } = setup()
    voice.start()
    FakeSpeechRecognition.last.emitError(code)
    FakeSpeechRecognition.last.end()
    expect(voice.getState()).toMatchObject({ phase: 'error', error })
  })

  it('engine-unreachable: the run fails, the transcript is kept, retry reopens the preview', async () => {
    const { voice, deps } = setup({ submit: vi.fn(async () => false) })
    voice.start()
    FakeSpeechRecognition.last.say('open the browser')
    await expect(voice.submit('open the browser')).resolves.toBe(false)
    expect(voice.getState()).toMatchObject({ phase: 'error', error: 'engine-unreachable', transcript: 'open the browser' })

    deps.onTranscript.mockClear()
    voice.retry()
    expect(voice.getState()).toMatchObject({ phase: 'preview', error: null })
    expect(deps.onTranscript).toHaveBeenCalledWith('open the browser')
  })

  it('a throwing submit is also engine-unreachable', async () => {
    const { voice } = setup({ submit: vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))) })
    voice.start()
    FakeSpeechRecognition.last.say('open notes')
    await voice.submit('open notes')
    expect(voice.getState().error).toBe('engine-unreachable')
  })

  it('starting again after an error is the "try again"', () => {
    const { voice } = setup()
    voice.start()
    FakeSpeechRecognition.last.emitError('network')
    FakeSpeechRecognition.last.end()
    voice.start()
    expect(voice.getState()).toMatchObject({ phase: 'listening', error: null })
    expect(FakeSpeechRecognition.instances).toHaveLength(2)
  })
})
