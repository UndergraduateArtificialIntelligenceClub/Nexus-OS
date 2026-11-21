import type { ReactNode } from 'react'

// A deliberately small markdown renderer for notes and README files. It builds
// React nodes, never HTML, so a file can't inject markup. Supported: headings,
// paragraphs, fenced code, ordered/unordered lists, blockquotes, rules, and
// inline strong/em/code/links. Images become an honest text reference because a
// bare file has no base path to resolve them against.

export interface MarkdownProps {
  source: string
  className?: string
}

export function Markdown({ source, className }: MarkdownProps) {
  return <div className={className ? `nx-md ${className}` : 'nx-md'}>{parseBlocks(source).map(renderBlock)}</div>
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w-]*)\s*$/
const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/
const QUOTE = /^ {0,3}>\s?/
const UL = /^ {0,3}[-*+]\s+(.*)$/
const OL = /^ {0,3}\d+[.)]\s+(.*)$/
const RULE = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || UL.test(line) || OL.test(line) || RULE.test(line)
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[1][0]
      const length = fence[1].length
      const close = new RegExp(`^ {0,3}${marker === '`' ? '`' : '~'}{${length},}\\s*$`)
      const body: string[] = []
      i++
      while (i < lines.length && !close.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      if (i < lines.length) i++
      blocks.push({ kind: 'code', lang: fence[2], text: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].replace(/\s+#+\s*$/, '') })
      i++
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      i++
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(lines[i].replace(QUOTE, ''))
        i++
      }
      blocks.push({ kind: 'quote', text: body.join('\n') })
      continue
    }

    const ordered = OL.exec(line)
    const unordered = ordered ? null : UL.exec(line)
    if (ordered || unordered) {
      const itemRe = ordered ? OL : UL
      const items: string[] = []
      while (i < lines.length) {
        const item = itemRe.exec(lines[i])
        if (!item) break
        items.push(item[1])
        i++
        // Indented continuation lines belong to the item above.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !itemRe.test(lines[i])) {
          items[items.length - 1] += ` ${lines[i].trim()}`
          i++
        }
      }
      blocks.push({ kind: 'list', ordered: Boolean(ordered), items })
      continue
    }

    const paragraph = [line.trim()]
    i++
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      paragraph.push(lines[i].trim())
      i++
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
  }

  return blocks
}

function renderBlock(block: Block, index: number): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      return (
        <Tag key={index} className={`nx-md-h${block.level}`}>
          {inline(block.text, `${index}`)}
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p key={index} className="nx-md-p">
          {inline(block.text, `${index}`)}
        </p>
      )
    case 'code':
      return (
        <pre key={index} className="nx-md-code" data-lang={block.lang || undefined}>
          <code>{block.text}</code>
        </pre>
      )
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag key={index} className="nx-md-list">
          {block.items.map((item, n) => (
            <li key={n}>{inline(item, `${index}.${n}`)}</li>
          ))}
        </Tag>
      )
    }
    case 'quote':
      return (
        <blockquote key={index} className="nx-md-quote">
          {block.text.split('\n').map((line, n) => (
            <p key={n}>{inline(line, `${index}.${n}`)}</p>
          ))}
        </blockquote>
      )
    case 'rule':
      return <hr key={index} className="nx-md-rule" />
  }
}

const SAFE_HREF = /^(?:https?:|mailto:)/i

function renderLink(label: string, href: string, key: string): ReactNode {
  if (SAFE_HREF.test(href) || href.startsWith('#')) {
    return (
      <a
        key={key}
        className="nx-md-link"
        href={href}
        target={href.startsWith('#') ? undefined : '_blank'}
        rel="noreferrer noopener"
      >
        {inline(label, `${key}.l`)}
      </a>
    )
  }
  // Unknown or script protocols keep the words but lose the link.
  return (
    <span key={key} className="nx-md-link" data-unsafe="true">
      {inline(label, `${key}.l`)}
    </span>
  )
}

/** Inline spans. Text is escaped by React; only these four constructs become elements. */
export function inline(text: string, keyPrefix = 'i'): ReactNode[] {
  const nodes: ReactNode[] = []
  let buffer = ''
  let i = 0
  let n = 0

  const flush = () => {
    if (buffer) {
      nodes.push(buffer)
      buffer = ''
    }
  }
  const nextKey = () => `${keyPrefix}.${n++}`

  while (i < text.length) {
    const rest = text.slice(i)

    if (rest[0] === '\\' && /[\\`*_{}[\]()#+\-.!>]/.test(rest[1] ?? '')) {
      buffer += rest[1]
      i += 2
      continue
    }

    if (rest[0] === '`') {
      const end = rest.indexOf('`', 1)
      if (end > 0) {
        flush()
        nodes.push(
          <code key={nextKey()} className="nx-md-inline-code">
            {rest.slice(1, end)}
          </code>,
        )
        i += end + 1
        continue
      }
    }

    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest)
    if (image) {
      flush()
      nodes.push(
        <span key={nextKey()} className="nx-md-image-ref">
          [image: {image[1] || 'untitled'}]
        </span>,
      )
      i += image[0].length
      continue
    }

    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest)
    if (link) {
      flush()
      nodes.push(renderLink(link[1], link[2], nextKey()))
      i += link[0].length
      continue
    }

    const strong = /^(\*\*|__)([^\n]+?)\1/.exec(rest)
    if (strong) {
      flush()
      nodes.push(<strong key={nextKey()}>{inline(strong[2], nextKey())}</strong>)
      i += strong[0].length
      continue
    }

    const em = /^(\*|_)([^*_\n]+?)\1/.exec(rest)
    if (em && (em[1] !== '_' || i === 0 || !/[A-Za-z0-9]/.test(text[i - 1]))) {
      flush()
      nodes.push(<em key={nextKey()}>{inline(em[2], nextKey())}</em>)
      i += em[0].length
      continue
    }

    buffer += rest[0]
    i++
  }

  flush()
  return nodes
}
