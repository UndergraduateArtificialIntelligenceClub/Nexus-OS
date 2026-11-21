import { describe, expect, it } from 'vitest'
import {
  CATEGORY_LABEL,
  FILE_GLYPH,
  classifyFile,
  extensionOf,
  formatBytes,
  formatWhen,
  viewerFor,
  type FileCategory,
} from './fileTypes'

// The Brahma extension sets, ported as a spec: one representative per category,
// case-insensitive, with dotfiles and extension-less files staying unknown.

describe('classifyFile', () => {
  const cases: Array<[string, FileCategory]> = [
    ['README.md', 'markdown'],
    ['notes.txt', 'text'],
    ['main.rs', 'code'],
    ['photo.JPG', 'image'],
    ['clip.MP4', 'video'],
    ['song.flac', 'audio'],
    ['paper.pdf', 'pdf'],
    ['brief.docx', 'docx'],
    ['data.csv', 'csv'],
    ['book.xlsx', 'excel'],
    ['payload.json', 'json'],
    ['feed.xml', 'xml'],
    ['deck.pptx', 'pptx'],
    ['bundle.7z', 'archive'],
    ['LICENSE', 'unknown'],
    ['.gitignore', 'unknown'],
  ]

  it.each(cases)('classifies %s as %s', (name, category) => {
    expect(classifyFile(name)).toBe(category)
  })

  it('treats a directory as a directory regardless of its name', () => {
    expect(classifyFile('archive.zip', true)).toBe('dir')
  })

  it('reads the extension from a path, not the folder name', () => {
    expect(classifyFile('/home/me/photo.png')).toBe('image')
    expect(classifyFile('C:\\Users\\me\\notes.md')).toBe('markdown')
  })

  it('handles trailing dots and empty extensions', () => {
    expect(extensionOf('name.')).toBe('')
    expect(classifyFile('name.')).toBe('unknown')
    expect(classifyFile('')).toBe('unknown')
  })
})

describe('glyphs and viewers', () => {
  const categories = Object.keys(FILE_GLYPH) as FileCategory[]

  it('gives every category a mark', () => {
    for (const category of categories) {
      expect(FILE_GLYPH[category]).toMatch(/^\[.\]$|^\(.\)$/)
    }
    expect(new Set(categories.map((c) => FILE_GLYPH[c])).size).toBe(categories.length)
  })

  it('maps every category to a viewer', () => {
    expect(viewerFor('markdown')).toBe('markdown')
    expect(viewerFor('text')).toBe('text')
    expect(viewerFor('code')).toBe('code')
    expect(viewerFor('csv')).toBe('text')
    expect(viewerFor('json')).toBe('text')
    expect(viewerFor('xml')).toBe('text')
    expect(viewerFor('image')).toBe('image')
    expect(viewerFor('video')).toBe('video')
    expect(viewerFor('audio')).toBe('audio')
    for (const category of ['pdf', 'docx', 'excel', 'pptx', 'archive', 'unknown'] as FileCategory[]) {
      expect(viewerFor(category)).toBe('unsupported')
      expect(CATEGORY_LABEL[category]).toBeTruthy()
    }
  })
})

describe('formatting', () => {
  it('formats bytes across the units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 ** 2)).toBe('1.0 MB')
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB')
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
  })

  it('formats modification times relative to now', () => {
    const now = new Date('2026-11-21T12:00:00').getTime()
    expect(formatWhen(now, now)).toBe('now')
    expect(formatWhen(now - 5 * 60_000, now)).toBe('5m')
    expect(formatWhen(now - 3 * 60 * 60_000, now)).toBe('3h')
    expect(formatWhen(now - 2 * 24 * 60 * 60_000, now)).toBe('2d')
    expect(formatWhen(new Date('2026-10-01T12:00:00').getTime(), now)).toBe('2026-10-01')
    expect(formatWhen(null, now)).toBe('—')
  })
})
