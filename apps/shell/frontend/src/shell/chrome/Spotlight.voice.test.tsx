import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/ui/testing/fixtures'
import { Spotlight } from './Spotlight'

// Spotlight as the voice preview (#35): the transcript is shown for review, Enter sends it
// as a voice run, Esc cancels without sending.

function renderPreview(text = 'open the browser') {
  const onClose = vi.fn()
  const onVoiceSubmit = vi.fn()
  const agent = vi.fn(() => ({ text: 'ok' }))
  renderWithProviders(
    <Spotlight open origin={null} onClose={onClose} voice={{ text, id: 1 }} onVoiceSubmit={onVoiceSubmit} />,
    { agent },
  )
  return { onClose, onVoiceSubmit, agent, input: screen.getByRole('combobox') }
}

describe('Spotlight voice preview', () => {
  it('shows the transcript, editable, with "ask" leading', () => {
    const { input } = renderPreview()
    expect(input).toHaveValue('open the browser')
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Review what you said')
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('ask nexus: open the browser')
  })

  it('"ask" leads even for a one-word transcript that names an app', () => {
    renderPreview('browser')
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('ask nexus: browser')
  })

  it('Enter sends the reviewed text as a voice submit, not a typed ask', () => {
    const { input, onVoiceSubmit, onClose, agent } = renderPreview()
    fireEvent.change(input, { target: { value: 'open the browser please' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onVoiceSubmit).toHaveBeenCalledWith('open the browser please')
    expect(onClose).toHaveBeenCalled()
    expect(onVoiceSubmit.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0])
    expect(agent).not.toHaveBeenCalled()
  })

  it('Esc cancels at once, even with text in the field', () => {
    const { input, onVoiceSubmit, onClose } = renderPreview()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onVoiceSubmit).not.toHaveBeenCalled()
    expect(input).toHaveValue('open the browser')
  })

  it('typed Spotlight keeps its clear-then-close Esc', () => {
    const onClose = vi.fn()
    renderWithProviders(<Spotlight open origin={null} onClose={onClose} />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'notes' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveValue('')
    expect(onClose).not.toHaveBeenCalled()
  })
})
