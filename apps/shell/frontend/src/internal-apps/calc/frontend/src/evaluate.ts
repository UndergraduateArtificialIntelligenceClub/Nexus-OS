// Expression evaluation for the calculator. A tiny shunting-yard: numbers,
// + − × ÷, % postfix and unary minus. Never guesses: an expression that is
// unfinished, divides by zero or overflows has no answer, and `solve` says which.

type Tok = { n: number } | { op: string }

const PREC: Record<string, number> = { '+': 1, '-': 1, '×': 2, '÷': 2, neg: 3, '%': 4 }

function tokenize(s: string): Tok[] | null {
  const out: Tok[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === ' ') {
      i++
      continue
    }
    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < s.length && /[0-9.]/.test(s[j])) j++
      const n = Number(s.slice(i, j))
      if (!Number.isFinite(n) || Number.isNaN(n)) return null
      out.push({ n })
      i = j
      continue
    }
    if ('+-×÷%'.includes(c)) {
      out.push({ op: c })
      i++
      continue
    }
    return null
  }
  return out.length ? out : null
}

function toRPN(toks: Tok[]): Tok[] | null {
  const out: Tok[] = []
  const ops: string[] = []
  let prev: Tok | null = null
  const popWhile = (prec: number) => {
    while (ops.length && PREC[ops[ops.length - 1]] >= prec) out.push({ op: ops.pop()! })
  }
  for (const t of toks) {
    if ('n' in t) {
      out.push(t)
    } else if (t.op === '%') {
      popWhile(PREC['%'])
      ops.push('%')
    } else if (t.op === '-' && (!prev || 'op' in prev)) {
      // Unary minus: right-associative, only pops strictly higher precedence.
      while (ops.length && PREC[ops[ops.length - 1]] > PREC.neg) out.push({ op: ops.pop()! })
      ops.push('neg')
    } else {
      popWhile(PREC[t.op])
      ops.push(t.op)
    }
    prev = t
  }
  while (ops.length) {
    const op = ops.pop()!
    // An operator left with nothing under it means the expression never finished.
    if (op === 'neg' || op === '%') {
      if (out.length < 1) return null
    } else if (out.length < 2) return null
    out.push({ op })
  }
  return out
}

/** Why an expression has no answer: unfinished, a division by zero, or too big to hold. */
export type SolveError = 'incomplete' | 'div0' | 'overflow'

/** Evaluates `expr`, naming the reason when there is no answer. */
export function solve(expr: string): { value: number } | { error: SolveError } {
  const incomplete = { error: 'incomplete' } as const
  const rpn = toRPN(tokenize(expr) ?? [])
  if (!rpn) return incomplete
  const stack: number[] = []
  for (const t of rpn) {
    if ('n' in t) {
      stack.push(t.n)
      continue
    }
    if (t.op === '%') {
      const a = stack.pop()
      if (a === undefined) return incomplete
      stack.push(a / 100)
    } else if (t.op === 'neg') {
      const a = stack.pop()
      if (a === undefined) return incomplete
      stack.push(-a)
    } else {
      const b = stack.pop()
      const a = stack.pop()
      if (a === undefined || b === undefined) return incomplete
      if (t.op === '÷' && b === 0) return { error: 'div0' }
      stack.push(t.op === '+' ? a + b : t.op === '-' ? a - b : t.op === '×' ? a * b : a / b)
    }
    if (!Number.isFinite(stack[stack.length - 1])) return { error: 'overflow' }
  }
  if (stack.length !== 1) return incomplete
  return { value: stack[0] }
}

/** The answer, or null when there is none (see `solve` for the reason). */
export function evaluate(expr: string): number | null {
  const r = solve(expr)
  return 'value' in r ? r.value : null
}

/** Formats a result for the display: trims float noise, keeps big numbers readable. */
export function format(n: number): string {
  if (Number.isInteger(n)) return String(n)
  const rounded = Math.round(n * 1e10) / 1e10
  return String(rounded)
}
