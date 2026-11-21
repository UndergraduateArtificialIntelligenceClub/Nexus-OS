// What each key does, as a pure step so the calculator's behaviour is testable
// without rendering. Standard-calculator rules:
//   - after `=`, a digit starts a new number; an operator carries the result on
//   - `=` with no answer shows why (÷ 0, overflow) and the next digit starts over
//   - `=` on an unfinished expression waits for the rest

import { format, solve, type SolveError } from './evaluate'

export interface CalcState {
  /** What the display shows; ASCII `-` so the evaluator can read it. */
  expr: string
  /** True right after `=` committed a result: the next digit replaces it. */
  fresh: boolean
  /** Set when `=` found no answer; any digit, C or ⌫ clears it. */
  error: string | null
  /** Committed sums, newest first. */
  history: string[]
}

export const INITIAL: CalcState = { expr: '', fresh: false, error: null, history: [] }

const HISTORY_MAX = 8

const MESSAGES: Record<Exclude<SolveError, 'incomplete'>, string> = {
  div0: "can't divide by 0",
  overflow: 'too big to show',
}

const isDigit = (k: string) => /^[0-9]$/.test(k)

/** Starts a new number with `k`, the way a digit or `.` does after `=` or an error. */
const startWith = (k: string) => (k === '.' ? '0.' : k)

export function press(s: CalcState, k: string): CalcState {
  if (s.error !== null) {
    if (isDigit(k) || k === '.') return { ...s, error: null, fresh: false, expr: startWith(k) }
    if (k === 'C' || k === 'back') return { ...s, error: null, fresh: false, expr: '' }
    return s
  }

  if (k === 'C') return { ...s, expr: '', fresh: false }
  if (k === 'back') return { ...s, expr: s.expr.slice(0, -1), fresh: false }

  if (k === '=') {
    if (s.fresh) return s
    const r = solve(s.expr)
    if ('error' in r) return r.error === 'incomplete' ? s : { ...s, error: MESSAGES[r.error], fresh: false }
    const result = format(r.value)
    // A bare number "equals" itself: nothing worth logging.
    if (result === s.expr) return { ...s, fresh: true }
    return { ...s, expr: result, fresh: true, history: [`${s.expr} = ${result}`, ...s.history].slice(0, HISTORY_MAX) }
  }

  if (k === 'neg') {
    // Flip the sign of the live result, or of the number being typed.
    const r = solve(s.expr)
    const expr = 'value' in r ? format(-r.value) : s.expr.startsWith('-') ? s.expr.slice(1) : '-' + s.expr
    return { ...s, expr }
  }

  if (isDigit(k) || k === '.') {
    if (s.fresh) return { ...s, expr: startWith(k), fresh: false }
    return { ...s, expr: s.expr + k }
  }

  // Operators: carry whatever is on the display forward.
  return { ...s, expr: s.expr + k, fresh: false }
}
