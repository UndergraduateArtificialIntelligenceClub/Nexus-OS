import { useEffect, useState } from 'react'
import { ClockWidget, type ClockSize } from '@/internal-apps/clock/frontend/src/App'
import { SIZE_ORDER, type Size } from './layout'

export type Kind = 'clock' | 'notes' | 'files' | 'terminal' | 'monitor'

export interface WidgetDef {
  label: string
  sizes: Size[]
  defaultSize: Size
  aliases: string[]
}

export const WIDGETS: Record<Kind, WidgetDef> = {
  clock: { label: 'clock', sizes: ['1x1', '2x1', '2x2'], defaultSize: '2x2', aliases: ['clock', 'time', 'watch'] },
  notes: { label: 'notes', sizes: ['2x1', '2x2'], defaultSize: '2x1', aliases: ['notes', 'note', 'notepad', 'memo'] },
  files: { label: 'files', sizes: ['1x1', '2x1'], defaultSize: '1x1', aliases: ['files', 'file', 'documents', 'docs'] },
  terminal: {
    label: 'terminal',
    sizes: ['2x1', '2x2'],
    defaultSize: '2x1',
    aliases: ['terminal', 'term', 'shell', 'console', 'cli'],
  },
  monitor: {
    label: 'system',
    sizes: ['1x1', '2x1'],
    defaultSize: '1x1',
    aliases: ['monitor', 'system', 'stats', 'cpu', 'memory', 'ram', 'usage'],
  },
}

export const KINDS = Object.keys(WIDGETS) as Kind[]

/** The supported size closest to the one asked for (ties go to the larger one). */
export function nearestSize(kind: Kind, wanted: Size): Size {
  const { sizes } = WIDGETS[kind]
  if (sizes.includes(wanted)) return wanted
  const target = SIZE_ORDER.indexOf(wanted)
  return [...sizes].sort(
    (a, b) =>
      Math.abs(SIZE_ORDER.indexOf(a) - target) - Math.abs(SIZE_ORDER.indexOf(b) - target) ||
      SIZE_ORDER.indexOf(b) - SIZE_ORDER.indexOf(a),
  )[0]
}

const CLOCK_SIZE: Record<Size, ClockSize> = { '1x1': 'small', '2x1': 'medium', '2x2': 'large' }

export function WidgetBody({ kind, size }: { kind: Kind; size: Size }) {
  switch (kind) {
    case 'clock':
      return <ClockWidget size={CLOCK_SIZE[size]} />
    case 'notes':
      return <Notes />
    case 'files':
      return <Files size={size} />
    case 'terminal':
      return <Terminal size={size} />
    case 'monitor':
      return <Monitor size={size} />
  }
}

// --- Placeholder widget faces (prototype only) ---

const NOTES_KEY = 'nexus-proto-notes'

function Notes() {
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(NOTES_KEY) ?? ''
    } catch {
      return ''
    }
  })
  return (
    <textarea
      className="w-notes"
      aria-label="Notes"
      placeholder="write something…"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        try {
          localStorage.setItem(NOTES_KEY, e.target.value)
        } catch {
          /* storage unavailable; keep it in memory */
        }
      }}
    />
  )
}

const RECENT_FILES: [string, string][] = [
  ['UI-Overview.md', 'now'],
  ['todoDoc.pdf', '1h'],
  ['README.md', '2d'],
  ['clock/App.tsx', '2d'],
]

function Files({ size }: { size: Size }) {
  const files = size === '1x1' ? RECENT_FILES.slice(0, 3) : RECENT_FILES
  return (
    <ul className="w-files">
      {files.map(([name, when]) => (
        <li key={name}>
          <span className="w-files-name">{name}</span>
          {size !== '1x1' && <span className="w-files-when">{when}</span>}
        </li>
      ))}
    </ul>
  )
}

function Terminal({ size }: { size: Size }) {
  const lines =
    size === '2x2'
      ? ['nexus$ agent status', 'engine   ready', 'tools    5 loaded', 'memory   412 notes', '', 'nexus$ ']
      : ['nexus$ agent status', 'engine   ready', 'nexus$ ']
  return (
    <pre className="w-mono w-term" aria-label="Terminal">
      {lines.map((line, i) => (
        <span key={i}>
          {line.startsWith('nexus$') ? (
            <>
              <span className="w-term-prompt">nexus$</span>
              {line.slice(6)}
            </>
          ) : (
            line
          )}
          {i === lines.length - 1 ? <span className="ascii-caret">_</span> : '\n'}
        </span>
      ))}
    </pre>
  )
}

function Monitor({ size }: { size: Size }) {
  const cpu = useDrift(38)
  const mem = useDrift(61)
  const gpu = useDrift(17)
  const width = size === '1x1' ? 6 : 22
  const bar = (name: string, v: number) => {
    const n = Math.round((v / 100) * width)
    return `${name.padEnd(4)}[${'#'.repeat(n)}${'.'.repeat(width - n)}]${String(v).padStart(4)}%`
  }
  return (
    <pre className="w-mono" aria-label={`CPU ${cpu}%, memory ${mem}%, GPU ${gpu}%`}>
      {[bar('cpu', cpu), bar('mem', mem), bar('gpu', gpu)].join('\n')}
    </pre>
  )
}

/** Fake reading that wanders a little every couple of seconds. */
function useDrift(base: number) {
  const [v, setV] = useState(base)
  useEffect(() => {
    const id = window.setInterval(() => {
      setV((prev) => Math.min(95, Math.max(4, Math.round(prev + (Math.random() - 0.5) * 10 + (base - prev) * 0.2))))
    }, 2000)
    return () => window.clearInterval(id)
  }, [base])
  return v
}
