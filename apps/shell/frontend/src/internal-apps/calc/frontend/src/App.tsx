import { useState } from 'react'
import type { AppProps } from '@/apps/types'
import { evaluate, format } from './evaluate'
import { INITIAL, press, type CalcState } from './keypad'
import './calc.css'

// The calculator: an honest arithmetic widget. Expression builds in the display,
// evaluates live, commits on `=`. No pretending to be a scientific tool. Key
// behaviour lives in keypad.ts; this file only draws it.

const KEYS: Array<[label: string, k: string][]> = [
  [
    ['C', 'C'],
    ['⌫', 'back'],
    ['%', '%'],
    ['÷', '÷'],
  ],
  [
    ['7', '7'],
    ['8', '8'],
    ['9', '9'],
    ['×', '×'],
  ],
  [
    ['4', '4'],
    ['5', '5'],
    ['6', '6'],
    ['−', '-'],
  ],
  [
    ['1', '1'],
    ['2', '2'],
    ['3', '3'],
    ['+', '+'],
  ],
  [
    ['±', 'neg'],
    ['0', '0'],
    ['.', '.'],
    ['=', '='],
  ],
]

/** Operator and control keys, drawn in pencil so the digits read first. */
const OPS = ['+', '-', '×', '÷', '%', 'C', 'back', 'neg']
/** The expression keeps ASCII `-` for the evaluator; show the typographic minus. */
const show = (s: string) => s.replace(/-/g, '−')

export function CalcApp({ size }: AppProps) {
  const wide = size === '2x1'
  const [state, setState] = useState<CalcState>(INITIAL)
  const { expr, error, history } = state

  const live = expr ? evaluate(expr) : null

  return (
    <div className="w-calc" data-wide={wide || undefined}>
      <div className="w-calc-display">
        {error !== null ? (
          <span className="w-calc-expr" data-error role="alert">
            <b aria-hidden="true">x </b>
            {error}
          </span>
        ) : (
          <>
            <span className="w-calc-expr">{show(expr) || '0'}</span>
            {live !== null && format(live) !== expr && <span className="w-calc-live">= {show(format(live))}</span>}
            {expr && live === null && (
              <span className="w-calc-live" data-bad>
                …
              </span>
            )}
          </>
        )}
      </div>
      <div className="w-calc-body">
        <div className="w-calc-pad" role="group" aria-label="keypad">
          {KEYS.flat().map(([label, k]) => (
            <button
              key={k}
              type="button"
              className="w-calc-key"
              data-op={OPS.includes(k) || undefined}
              data-commit={k === '=' || undefined}
              onClick={() => setState((st) => press(st, k))}
            >
              {label}
            </button>
          ))}
        </div>
        {wide && (
          <ul className="w-calc-history" aria-label="history">
            {history.length === 0 && <li className="w-calc-hist-empty">no sums yet</li>}
            {history.map((line, i) => (
              <li key={i}>{show(line)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
