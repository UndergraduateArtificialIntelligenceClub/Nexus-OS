import type { KeyboardEvent, PointerEvent } from 'react'
import { AsciiMeter } from './AsciiMeter'

// The ASCII slider: the shell's `[####....]` meter, made adjustable. It is the one
// range control in the library (seek, volume, anything with a min and max), so it
// looks exactly like every other reading on the desk. Keyboard follows the WAI-ARIA
// slider pattern; pointer sets the value from where the bar was hit, then drags.

export interface AsciiSliderProps {
  /** Accessible name, e.g. "seek" or "volume". */
  label: string
  value: number
  min?: number
  max: number
  /** Arrow-key step. Page keys move a tenth of the range. Defaults to 1% of it. */
  step?: number
  onChange: (value: number) => void
  /** Bar length in characters, not counting the brackets. */
  width?: number
  /** What a screen reader hears, e.g. "0:42 of 2:10". Defaults to the number. */
  formatValue?: (value: number) => string
  disabled?: boolean
  className?: string
}

const tidy = (v: number) => Math.round(v * 1e6) / 1e6

export function AsciiSlider({ label, value, min = 0, max, step, onChange, width = 10, formatValue, disabled = false, className }: AsciiSliderProps) {
  const span = max - min
  const known = span > 0
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const current = known ? clamp(value) : min
  const unit = step ?? span / 100
  const off = disabled || !known

  const set = (v: number) => {
    const next = tidy(clamp(v))
    if (next !== current) onChange(next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (off || e.metaKey || e.ctrlKey || e.altKey) return
    const moves: Record<string, () => number> = {
      ArrowRight: () => current + unit,
      ArrowUp: () => current + unit,
      ArrowLeft: () => current - unit,
      ArrowDown: () => current - unit,
      PageUp: () => current + span / 10,
      PageDown: () => current - span / 10,
      Home: () => min,
      End: () => max,
    }
    const move = moves[e.key]
    if (!move) return
    // The slider owns these keys; a player around it must not also seek on them.
    e.preventDefault()
    e.stopPropagation()
    set(move())
  }

  // The bar is `[` + width cells + `]`, so the cells start one character in.
  const fromPointer = (e: PointerEvent<HTMLSpanElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width <= 0) return
    const cell = r.width / (width + 2)
    const fraction = (e.clientX - r.left - cell) / (cell * width)
    set(min + Math.min(1, Math.max(0, fraction)) * span)
  }

  return (
    <span
      role="slider"
      className={className ? `nx-aslider ${className}` : 'nx-aslider'}
      tabIndex={off ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={known ? max : min}
      aria-valuenow={tidy(current)}
      aria-valuetext={formatValue ? formatValue(current) : undefined}
      aria-disabled={off || undefined}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (off || e.button !== 0) return
        e.preventDefault() // no text selection while scrubbing
        e.currentTarget.focus({ preventScroll: true })
        e.currentTarget.setPointerCapture?.(e.pointerId)
        fromPointer(e)
      }}
      onPointerMove={(e) => {
        if (!off && e.currentTarget.hasPointerCapture?.(e.pointerId)) fromPointer(e)
      }}
      onPointerUp={(e) => e.currentTarget.releasePointerCapture?.(e.pointerId)}
    >
      <AsciiMeter value={current - min} max={known ? span : 1} width={width} showValue={false} />
    </span>
  )
}
