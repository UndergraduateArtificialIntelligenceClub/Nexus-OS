import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AsciiFrame, ENTER_MS, useReducedMotion, type Phase } from './AsciiFrame'
import {
  CELL,
  COLS,
  GRID_H,
  GRID_W,
  ROWS,
  SIZE_DIMS,
  SIZE_ORDER,
  findSlot,
  offset,
  pack,
  span,
  type Placement,
  type Size,
  type Slot,
} from './layout'
import { KINDS, WIDGETS, WidgetBody, nearestSize, type Kind } from './widgets'
import { parseCommand, type SizeRequest } from './agent'

interface Item extends Placement {
  kind: Kind
  phase: Phase
  delay: number
}

let seq = 0
const makeItem = (kind: Kind, size: Size, slot: Slot, delay = 0): Item => ({
  id: `${kind}-${++seq}`,
  kind,
  size,
  ...slot,
  phase: 'enter',
  delay,
})

// Opening screen: a few widgets build in one after another.
const INITIAL: Item[] = [
  makeItem('clock', '2x2', { col: 0, row: 0 }, 150),
  makeItem('notes', '2x1', { col: 2, row: 0 }, 400),
  makeItem('monitor', '1x1', { col: 2, row: 1 }, 600),
  makeItem('files', '1x1', { col: 3, row: 1 }, 750),
]

const CELLS = Array.from({ length: COLS * ROWS }, (_, i) => ({ col: i % COLS, row: Math.floor(i / COLS) }))
const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
const HELP = 'try "show terminal", "make clock small", "hide notes", "tidy up" or "hide everything".'

type TrayState = 'closed' | 'open' | 'closing'

export function Prototype() {
  const [items, setItems] = useState<Item[]>(INITIAL)
  const itemsRef = useRef(items)
  const [reply, setReply] = useState('')
  const [input, setInput] = useState('')
  const [tray, setTray] = useState<TrayState>('closed')
  const inputRef = useRef<HTMLInputElement>(null)
  const reduced = useReducedMotion()
  const scale = useFitScale(GRID_W, GRID_H)

  // --- layout operations (each returns the agent's reply) ---

  const commit = (next: Item[]) => {
    itemsRef.current = next
    setItems(next)
  }
  const active = () => itemsRef.current.filter((i) => i.phase !== 'exit')
  const applyActive = (next: Item[]) => commit([...itemsRef.current.filter((i) => i.phase === 'exit'), ...next])

  const resolveSize = (kind: Kind, current: Size, req: SizeRequest): Size => {
    if (req !== 'up' && req !== 'down') return nearestSize(kind, req)
    const sizes = WIDGETS[kind].sizes
    const idx = sizes.indexOf(current)
    return sizes[Math.min(sizes.length - 1, Math.max(0, idx + (req === 'up' ? 1 : -1)))]
  }

  const show = (kind: Kind, req?: SizeRequest): string => {
    const { label, defaultSize } = WIDGETS[kind]
    const act = active()
    const existing = act.find((i) => i.kind === kind)
    if (existing) return req ? resize(kind, req) : `${label} is already here.`
    const size = req && req !== 'up' && req !== 'down' ? nearestSize(kind, req) : defaultSize
    const slot = findSlot(act, size)
    if (slot) {
      applyActive([...act, makeItem(kind, size, slot)])
      return `placed ${label}.`
    }
    const packed = pack([...act, makeItem(kind, size, { col: 0, row: 0 })])
    if (packed) {
      applyActive(packed)
      return `made room and placed ${label}.`
    }
    return `no room for ${label}. hide something first.`
  }

  const hide = (kind: Kind): string => {
    const { label } = WIDGETS[kind]
    const it = active().find((i) => i.kind === kind)
    if (!it) return `${label} isn't on screen.`
    commit(itemsRef.current.map((i) => (i.id === it.id ? { ...i, phase: 'exit' } : i)))
    return `hid ${label}.`
  }

  const resize = (kind: Kind, req: SizeRequest): string => {
    const { label } = WIDGETS[kind]
    const act = active()
    const it = act.find((i) => i.kind === kind)
    if (!it) return show(kind, req)
    const size = resolveSize(kind, it.size, req)
    if (size === it.size) return `${label} is already ${size}.`
    const slot = findSlot(act, size, it.id, it)
    if (slot) {
      applyActive(act.map((i) => (i.id === it.id ? { ...i, size, ...slot } : i)))
      return `${label} is now ${size}.`
    }
    const packed = pack(act.map((i) => (i.id === it.id ? { ...i, size } : i)))
    if (packed) {
      applyActive(packed)
      return `rearranged to make ${label} ${size}.`
    }
    return `not enough room to make ${label} ${size}.`
  }

  const tidy = (): string => {
    const act = active()
    const packed = pack(act)
    if (!packed || packed.every((p, i) => p.col === act[i].col && p.row === act[i].row)) return 'already tidy.'
    applyActive(packed)
    return 'tidied up.'
  }

  const hideAll = (): string => {
    if (active().length === 0) return 'nothing to hide.'
    commit(itemsRef.current.map((i) => ({ ...i, phase: 'exit' })))
    return 'cleared the desk.'
  }

  const remove = (id: string) => commit(itemsRef.current.filter((i) => i.id !== id))

  const run = (text: string) => {
    const cmd = parseCommand(text)
    switch (cmd.type) {
      case 'show':
        return show(cmd.kind, cmd.size)
      case 'hide':
        return hide(cmd.kind)
      case 'resize':
        return resize(cmd.kind, cmd.size)
      case 'tidy':
        return tidy()
      case 'hideAll':
        return hideAll()
      case 'help':
        return HELP
      case 'unknown':
        return `i can only arrange widgets in this prototype. ${HELP}`
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    setReply(run(input))
    setInput('')
  }

  // --- keyboard: ⌘/Ctrl+K tray, "/" to ask, Esc to close ---

  // Ignore presses while the tray is still un-drawing.
  const toggleTray = () => setTray((s) => (s === 'closed' ? 'open' : 'closing'))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggleTray()
      } else if (e.key === 'Escape') {
        setTray((s) => (s === 'open' ? 'closing' : s))
        inputRef.current?.blur()
      } else if (e.key === '/' && !isTypingTarget(e.target)) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Replies fade out on their own.
  useEffect(() => {
    if (!reply) return
    const id = window.setTimeout(() => setReply(''), 6000)
    return () => window.clearTimeout(id)
  }, [reply])

  return (
    <div className="proto" data-reduced={reduced || undefined}>
      <main className="proto-stage">
        <div className="proto-grid-box" style={{ width: GRID_W * scale, height: GRID_H * scale }}>
          <div className="proto-grid" style={{ width: GRID_W, height: GRID_H, transform: `scale(${scale})` }}>
            {CELLS.map(({ col, row }) => (
              <span
                key={`${col}-${row}`}
                className="proto-cell-dot"
                style={{ left: offset(col) + CELL / 2, top: offset(row) + CELL / 2 }}
                aria-hidden="true"
              >
                ·
              </span>
            ))}
            {items.map((it) => {
              const d = SIZE_DIMS[it.size]
              return (
                <section
                  key={it.id}
                  className="proto-slot"
                  aria-label={WIDGETS[it.kind].label}
                  style={{
                    width: span(d.w),
                    height: span(d.h),
                    transform: `translate(${offset(it.col)}px, ${offset(it.row)}px)`,
                  }}
                >
                  <AsciiFrame
                    phase={it.phase}
                    delay={it.delay}
                    label={WIDGETS[it.kind].label}
                    moveKey={`${it.col},${it.row},${it.size}`}
                    onExited={() => remove(it.id)}
                  >
                    <WidgetBody kind={it.kind} size={it.size} />
                  </AsciiFrame>
                </section>
              )
            })}
          </div>
        </div>
      </main>

      <footer className="proto-dock">
        {tray !== 'closed' && (
          <Tray
            phase={tray === 'open' ? 'enter' : 'exit'}
            items={items.filter((i) => i.phase !== 'exit')}
            reduced={reduced}
            onPick={(kind, size) => setReply(size ? show(kind, size) : show(kind))}
            onHide={(kind) => setReply(hide(kind))}
            onClosed={() => setTray('closed')}
          />
        )}
        <form className="proto-prompt" onSubmit={onSubmit}>
          <label htmlFor="proto-ask" className="sr-only">
            Ask Nexus
          </label>
          <span className="proto-prompt-mark" aria-hidden="true">
            &gt;
          </span>
          <input
            id="proto-ask"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='ask nexus, e.g. "show terminal"'
            autoComplete="off"
            spellCheck={false}
          />
        </form>
        <p className="proto-reply" aria-live="polite">
          {reply}
        </p>
        <p className="proto-hint">
          <button type="button" className="proto-hint-btn" onClick={toggleTray}>
            <kbd>{IS_MAC ? '⌘' : 'Ctrl'}</kbd>
            <kbd>K</kbd> widgets
          </button>
          <span aria-hidden="true">·</span>
          <span>
            <kbd>/</kbd> ask
          </span>
        </p>
      </footer>
    </div>
  )
}

interface TrayProps {
  phase: Phase
  items: Item[]
  reduced: boolean
  onPick: (kind: Kind, size?: Size) => void
  onHide: (kind: Kind) => void
  onClosed: () => void
}

/** Fallback to the agent: a widget list opened with ⌘/Ctrl+K. Builds in like any widget. */
function Tray({ phase, items, reduced, onPick, onHide, onClosed }: TrayProps) {
  const firstRef = useRef<HTMLButtonElement>(null)

  // Content is inert while it types in, so focus once it has settled.
  useEffect(() => {
    if (phase !== 'enter') return
    const id = window.setTimeout(() => firstRef.current?.focus(), reduced ? 0 : ENTER_MS)
    return () => window.clearTimeout(id)
  }, [phase, reduced])

  return (
    <div className="proto-tray" role="dialog" aria-label="Widgets">
      <AsciiFrame phase={phase} label="widgets" fluid onExited={onClosed}>
        <ul className="proto-tray-list">
          {KINDS.map((kind, idx) => {
            const def = WIDGETS[kind]
            const current = items.find((i) => i.kind === kind)
            return (
              <li key={kind} className="proto-tray-row">
                <span className="proto-tray-name">{def.label}</span>
                <span className="proto-tray-sizes" role="group" aria-label={`${def.label} size`}>
                  {SIZE_ORDER.map((size) => (
                    <button
                      key={size}
                      type="button"
                      className="chip"
                      disabled={!def.sizes.includes(size)}
                      aria-pressed={current?.size === size}
                      onClick={() => onPick(kind, size)}
                    >
                      {size}
                    </button>
                  ))}
                </span>
                <button
                  ref={idx === 0 ? firstRef : undefined}
                  type="button"
                  className="chip chip--action"
                  onClick={() => (current ? onHide(kind) : onPick(kind))}
                >
                  {current ? 'hide' : 'add'}
                </button>
              </li>
            )
          })}
        </ul>
      </AsciiFrame>
    </div>
  )
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))
}

/** Shrinks the grid to fit small windows; never scales it up. */
function useFitScale(w: number, h: number) {
  const calc = () => Math.max(0.3, Math.min(1, (window.innerWidth - 48) / w, (window.innerHeight - 190) / h))
  const [scale, setScale] = useState(calc)
  useEffect(() => {
    const onResize = () => setScale(calc())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return scale
}
