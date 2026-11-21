import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Markdown } from './markdown'

// The safe markdown renderer: structure becomes elements, everything else stays
// text. No HTML string is ever injected.

describe('markdown', () => {
  it('renders headings, paragraphs, lists, quotes and rules', () => {
    const { container } = render(
      <Markdown
        source={[
          '# Title',
          '',
          'A paragraph with two lines',
          'joined together.',
          '',
          '- one',
          '- two',
          '',
          '1. first',
          '2. second',
          '',
          '> quoted',
          '',
          '---',
        ].join('\n')}
      />,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeVisible()
    expect(screen.getByText('A paragraph with two lines joined together.')).toBeVisible()
    expect(screen.getAllByRole('list')).toHaveLength(2)
    expect(screen.getByText('quoted')).toBeVisible()
    expect(container.querySelector('hr')).not.toBeNull()
  })

  it('renders strong, emphasis and inline code', () => {
    render(<Markdown source="A **bold** word, an *italic* word and `code`." />)

    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('italic').tagName).toBe('EM')
    expect(screen.getByText('code').tagName).toBe('CODE')
  })

  it('links only safe protocols', () => {
    const { container } = render(
      <Markdown source="[safe](https://example.com) and [unsafe](javascript:alert(1)) and [local](#section)" />,
    )

    const safe = screen.getByRole('link', { name: 'safe' })
    expect(safe).toHaveAttribute('href', 'https://example.com')
    expect(safe).toHaveAttribute('rel', 'noreferrer noopener')

    expect(screen.queryByRole('link', { name: 'unsafe' })).toBeNull()
    expect(screen.getByText('unsafe')).toBeVisible()
    expect(container.querySelector('a[href^="javascript"]')).toBeNull()

    expect(screen.getByRole('link', { name: 'local' })).toHaveAttribute('href', '#section')
  })

  it('keeps raw HTML as text', () => {
    const { container } = render(<Markdown source={'Look: <img src=x onerror=alert(1)> and <script>bad()</script>'} />)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeVisible()
  })

  it('does not parse markdown inside a fenced code block', () => {
    const { container } = render(<Markdown source={'```ts\n# not a heading\nconst x = **raw**\n```'} />)

    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('# not a heading\nconst x = **raw**')
    expect(container.querySelector('pre')).toHaveAttribute('data-lang', 'ts')
  })

  it('renders an image reference instead of fetching it', () => {
    const { container } = render(<Markdown source="![diagram](https://example.com/x.png)" />)

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('[image: diagram]')).toBeVisible()
  })

  it('honors escaped punctuation', () => {
    render(<Markdown source={'Not \\*emphasis\\* and not \\`code\\`.'} />)
    expect(screen.getByText('Not *emphasis* and not `code`.')).toBeVisible()
  })
})
