import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSpeechRecognition, installFakeSpeechRecognition } from '../voice/fakeSpeechRecognition'
import { createSpeechInput } from '../voice/speechInput'
import { createVoiceStore, VoiceProvider, type VoiceDeps, type VoiceStore } from '../voice/voiceStore'
import { MicButton, PRIVACY_NOTE, micLabel, tail, usePushToTalk } from './MicButton'

// The menu-bar mic (#35): toggle, push-to-talk, live text, and an explicit label per error.

let uninstall: () => void

beforeEach(() => {
  uninstall = installFakeSpeechRecognition()
})

afterEach(() => uninstall())

function Harness({ voice, ptt = true }: { voice: VoiceStore; ptt?: boolean }) {
  usePushToTalk(voice, ptt)
  return (
    <VoiceProvider store={voice}>
      <MicButton />
    </VoiceProvider>
  )
}

function setup(overrides: Partial<Omit<VoiceDeps, 'onTranscript'>> = {}) {
  const deps = { submit: vi.fn(async () => true), onTranscript: vi.fn<(text: string) => void>(), ...overrides }
  const voice = createVoiceStore(deps)
  render(<Harness voice={voice} />)
  return { voice, deps }
}

const mic = () => screen.getByRole('button', { name: /mic|listening|review|sending|offline|blocked/ })

describe('MicButton', () => {
  it('replaces the placeholder with a working mic control', () => {
    setup()
    expect(mic()).toHaveTextContent('mic')
    expect(mic()).toHaveAttribute('aria-pressed', 'false')
  })

  it('says what leaves the machine', () => {
    setup()
    expect(mic().getAttribute('title')).toContain(PRIVACY_NOTE)
  })

  it('click toggles listening and shows the words so far', () => {
    setup()
    fireEvent.click(mic())
    expect(mic()).toHaveTextContent('listening')
    expect(mic()).toHaveAttribute('aria-pressed', 'true')

    act(() => {
      FakeSpeechRecognition.last.emitStart()
      FakeSpeechRecognition.last.emitResult('open the')
    })
    expect(screen.getByText('open the')).toBeInTheDocument()

    fireEvent.click(mic())
    expect(FakeSpeechRecognition.last.stopped).toBe(true)
  })

  it('hands the final transcript to the preview and waits there', () => {
    const { deps } = setup()
    fireEvent.click(mic())
    act(() => FakeSpeechRecognition.last.say('open the browser'))
    expect(deps.onTranscript).toHaveBeenCalledWith('open the browser')
    expect(mic()).toHaveTextContent('review')
    expect(mic()).toBeDisabled()
    expect(deps.submit).not.toHaveBeenCalled()
  })

  it.each([
    ['not-allowed', 'mic blocked'],
    ['audio-capture', 'no mic'],
    ['network', 'voice offline'],
  ])('shows an explicit state for %s', (code, label) => {
    setup()
    fireEvent.click(mic())
    act(() => {
      FakeSpeechRecognition.last.emitError(code)
      FakeSpeechRecognition.last.end()
    })
    expect(mic()).toHaveTextContent(label)
    expect(mic()).toHaveAttribute('data-error')
  })

  it('shows "engine offline" when the run fails, and clicking reopens the preview', async () => {
    const { voice, deps } = setup({ submit: vi.fn(async () => false) })
    fireEvent.click(mic())
    act(() => FakeSpeechRecognition.last.say('open the browser'))
    await act(() => voice.submit('open the browser'))
    expect(mic()).toHaveTextContent('engine offline')
    deps.onTranscript.mockClear()
    fireEvent.click(mic())
    expect(deps.onTranscript).toHaveBeenCalledWith('open the browser')
  })

  it('says "voice unsupported" when the webview has no recognizer', () => {
    const voice = createVoiceStore({
      submit: async () => true,
      onTranscript: () => {},
      createInput: (h) => createSpeechInput(h, { Recognition: null }),
    })
    render(<Harness voice={voice} />)
    expect(screen.getByText('voice unsupported')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('push-to-talk', () => {
  const combo = { code: 'Space', key: ' ', shiftKey: true, ctrlKey: true, metaKey: true }

  it('holding the keys listens; releasing finishes the phrase', () => {
    const { voice } = setup()
    fireEvent.keyDown(document.body, combo)
    expect(voice.getState().phase).toBe('listening')
    fireEvent.keyDown(document.body, { ...combo, repeat: true })
    expect(FakeSpeechRecognition.instances).toHaveLength(1)
    fireEvent.keyUp(document.body, { code: 'Space', key: ' ' })
    expect(FakeSpeechRecognition.last.stopped).toBe(true)
  })

  it('Esc cancels listening and is not passed on', () => {
    const { voice } = setup()
    const later = vi.fn()
    window.addEventListener('keydown', later)
    fireEvent.click(mic())
    fireEvent.keyDown(document.body, { key: 'Escape' })
    window.removeEventListener('keydown', later)
    expect(voice.getState().phase).toBe('idle')
    expect(FakeSpeechRecognition.last.aborted).toBe(true)
    expect(later).not.toHaveBeenCalled()
  })

  it('Esc is left alone when voice is idle (exit fullscreen still works)', () => {
    setup()
    const later = vi.fn()
    window.addEventListener('keydown', later)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    window.removeEventListener('keydown', later)
    expect(later).toHaveBeenCalled()
  })
})

describe('labels', () => {
  it('maps every phase and error', () => {
    expect(micLabel('idle', null)).toBe('mic')
    expect(micLabel('submitting', null)).toBe('sending')
    expect(micLabel('error', 'unsupported')).toBe('voice unsupported')
    expect(micLabel('error', 'engine-unreachable')).toBe('engine offline')
  })

  it('keeps only the newest words of a long phrase', () => {
    expect(tail('short')).toBe('short')
    const long = 'search the web for the weather in edmonton this weekend please'
    expect(tail(long)).toHaveLength(40)
    expect(tail(long).endsWith('weekend please')).toBe(true)
  })
})
