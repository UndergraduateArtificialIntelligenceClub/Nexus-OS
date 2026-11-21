import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AsciiSlider } from '@/ui'

// The ASCII slider: a `[####....]` meter you can drive. Keyboard follows the
// WAI-ARIA slider pattern; pointer sets the value from where the bar was hit.

function Controlled({ initial = 50, onChange = () => {}, ...rest }: { initial?: number; onChange?: (v: number) => void; step?: number; disabled?: boolean }) {
  const [v, setV] = useState(initial)
  return (
    <AsciiSlider
      label="volume"
      value={v}
      max={100}
      width={10}
      formatValue={(x) => `${x} percent`}
      onChange={(x) => {
        setV(x)
        onChange(x)
      }}
      {...rest}
    />
  )
}

describe('AsciiSlider', () => {
  it('exposes the slider role, range and readable value', () => {
    render(<Controlled initial={40} />)
    const s = screen.getByRole('slider', { name: 'volume' })
    expect(s).toHaveAttribute('aria-valuemin', '0')
    expect(s).toHaveAttribute('aria-valuemax', '100')
    expect(s).toHaveAttribute('aria-valuenow', '40')
    expect(s).toHaveAttribute('aria-valuetext', '40 percent')
    expect(s).toHaveAttribute('tabindex', '0')
    expect(s).toHaveTextContent('[####......]')
  })

  it('steps with the arrow keys and jumps with Page, Home and End', async () => {
    const user = userEvent.setup()
    render(<Controlled step={5} />)
    const s = screen.getByRole('slider')
    s.focus()
    await user.keyboard('{ArrowRight}')
    expect(s).toHaveAttribute('aria-valuenow', '55')
    await user.keyboard('{ArrowUp}')
    expect(s).toHaveAttribute('aria-valuenow', '60')
    await user.keyboard('{ArrowLeft}{ArrowDown}')
    expect(s).toHaveAttribute('aria-valuenow', '50')
    await user.keyboard('{PageUp}')
    expect(s).toHaveAttribute('aria-valuenow', '60')
    await user.keyboard('{PageDown}{PageDown}')
    expect(s).toHaveAttribute('aria-valuenow', '40')
    await user.keyboard('{End}')
    expect(s).toHaveAttribute('aria-valuenow', '100')
    await user.keyboard('{ArrowRight}')
    expect(s).toHaveAttribute('aria-valuenow', '100') // clamped
    await user.keyboard('{Home}')
    expect(s).toHaveAttribute('aria-valuenow', '0')
  })

  it('keeps the keys it handles from reaching the player around it', () => {
    const outer = vi.fn()
    render(
      <div onKeyDown={outer}>
        <Controlled />
      </div>,
    )
    const s = screen.getByRole('slider')
    fireEvent.keyDown(s, { key: 'ArrowRight' })
    expect(outer).not.toHaveBeenCalled()
    fireEvent.keyDown(s, { key: 'm' })
    expect(outer).toHaveBeenCalledTimes(1)
  })

  it('sets the value from where the bar is pressed, and follows a drag', () => {
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    const s = screen.getByRole('slider')
    // 12 characters wide (`[` + 10 + `]`), 120px: each character is 10px.
    s.getBoundingClientRect = () => ({ left: 100, width: 120, top: 0, height: 20, right: 220, bottom: 20, x: 100, y: 0, toJSON: () => ({}) })
    s.setPointerCapture = vi.fn()
    s.hasPointerCapture = vi.fn(() => true)
    s.releasePointerCapture = vi.fn()

    fireEvent.pointerDown(s, { clientX: 110 + 25, pointerId: 1, button: 0 }) // 2.5 of 10 cells
    expect(onChange).toHaveBeenLastCalledWith(25)
    fireEvent.pointerMove(s, { clientX: 110 + 80, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(80)
    fireEvent.pointerMove(s, { clientX: 400, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(100) // past the end clamps
    fireEvent.pointerUp(s, { clientX: 400, pointerId: 1 })
    onChange.mockClear()
    s.hasPointerCapture = vi.fn(() => false)
    fireEvent.pointerMove(s, { clientX: 120, pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled() // released: hovering does nothing
  })

  it('does nothing while disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Controlled disabled onChange={onChange} />)
    const s = screen.getByRole('slider')
    expect(s).toHaveAttribute('aria-disabled', 'true')
    expect(s).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(s, { key: 'ArrowRight' })
    fireEvent.pointerDown(s, { clientX: 10, pointerId: 1, button: 0 })
    await user.click(s)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('draws an empty bar when the range is not known yet', () => {
    render(<AsciiSlider label="seek" value={0} max={0} width={4} onChange={() => {}} />)
    expect(screen.getByRole('slider')).toHaveTextContent('[....]')
  })
})
