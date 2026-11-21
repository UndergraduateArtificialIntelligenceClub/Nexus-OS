import { describe, expect, it } from 'vitest'
import { INITIAL, press, type CalcState } from './keypad'

// The keypad as a standard calculator: what each key does to the display,
// especially right after `=` and after an error.

const run = (keys: string[], from: CalcState = INITIAL) => keys.reduce(press, from)
const typed = (s: string) => run([...s])

describe('keypad', () => {
  it('builds an expression and commits it on =', () => {
    const s = run(['1', '2', '×', '4', '='])
    expect(s.expr).toBe('48')
    expect(s.history).toEqual(['12×4 = 48'])
  })

  describe('after =', () => {
    const done = run(['1', '2', '×', '4', '='])

    it('a digit starts a new number instead of appending to the result', () => {
      expect(press(done, '9').expr).toBe('9')
    })

    it('a decimal point starts a new number at 0.', () => {
      expect(press(done, '.').expr).toBe('0.')
    })

    it('an operator carries the result forward', () => {
      expect(run(['+', '2', '='], done).expr).toBe('50')
      expect(press(done, '÷').expr).toBe('48÷')
      expect(press(done, '%').expr).toBe('48%')
    })

    it('± flips the result and still lets the next digit start fresh', () => {
      const flipped = press(done, 'neg')
      expect(flipped.expr).toBe('-48')
      expect(press(flipped, '7').expr).toBe('7')
    })

    it('backspace edits the result, then digits append again', () => {
      const edited = press(done, 'back')
      expect(edited.expr).toBe('4')
      expect(press(edited, '2').expr).toBe('42')
    })

    it('pressing = again does not log the bare result to history', () => {
      expect(press(done, '=').history).toEqual(['12×4 = 48'])
    })
  })

  describe('dividing by zero', () => {
    const err = run([...'9÷0', '='])

    it('shows an error instead of ignoring =', () => {
      expect(err.error).toBe("can't divide by 0")
      expect(err.history).toEqual([])
    })

    it('a digit clears the error and starts a new number', () => {
      const next = press(err, '7')
      expect(next.error).toBeNull()
      expect(next.expr).toBe('7')
    })

    it('a decimal point clears the error and starts at 0.', () => {
      expect(press(err, '.')).toMatchObject({ error: null, expr: '0.' })
    })

    it('C and backspace clear the error back to 0', () => {
      expect(press(err, 'C')).toMatchObject({ error: null, expr: '' })
      expect(press(err, 'back')).toMatchObject({ error: null, expr: '' })
    })

    it('operators, ± and = do nothing while the error shows', () => {
      for (const k of ['+', '-', '×', '÷', '%', 'neg', '=']) expect(press(err, k)).toBe(err)
    })

    it('a zero that turns into a decimal is not an error', () => {
      expect(run(['.', '5', '='], typed('9÷0'))).toMatchObject({ error: null, expr: '18' })
    })

    it('a division by zero anywhere in the expression is caught', () => {
      expect(run([...'2+6÷0×3', '=']).error).toBe("can't divide by 0")
    })
  })

  it('= on an unfinished expression is still ignored', () => {
    const s = typed('5+')
    expect(press(s, '=')).toBe(s)
  })

  it('C clears the expression but keeps history', () => {
    const s = run(['2', '+', '2', '=', '1', 'C'])
    expect(s.expr).toBe('')
    expect(s.history).toEqual(['2+2 = 4'])
  })

  it('keeps the last 8 sums', () => {
    let s = INITIAL
    for (let i = 1; i <= 10; i++) s = run([String(i % 10), '+', '1', '='], s)
    expect(s.history).toHaveLength(8)
    expect(s.history[0]).toBe('0+1 = 1')
  })
})
