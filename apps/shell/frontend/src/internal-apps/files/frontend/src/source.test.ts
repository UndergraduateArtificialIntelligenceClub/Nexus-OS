import { describe, expect, it } from 'vitest'
import { classifyFile, viewerFor } from './fileTypes'
import { defaultFileSource, fixtureSource } from './source'

// The fixture source is the browser/test implementation of the same seam Tauri
// fills with the home directory. One fixture per viewer kind lives here.

describe('fixtureSource', () => {
  it('lists the home folder with files and a real subfolder', async () => {
    const home = await fixtureSource.home()
    const entries = await fixtureSource.readDir(home)
    const names = entries.map((entry) => entry.name)

    expect(names).toEqual(
      expect.arrayContaining(['design', 'readme.md', 'notes.txt', 'hello.ts', 'dot.png', 'tone.wav', 'clip.mp4', 'spec.pdf', 'bundle.zip']),
    )
    expect(entries.find((entry) => entry.name === 'design')?.isDir).toBe(true)
    expect(entries.find((entry) => entry.name === 'readme.md')?.size).toBeGreaterThan(0)
  })

  it('navigates into a subfolder', async () => {
    const home = await fixtureSource.home()
    const entries = await fixtureSource.readDir(`${home}/design`)
    expect(entries.map((entry) => entry.name)).toEqual(['colors.md'])
    expect(await fixtureSource.readText(`${home}/design/colors.md`)).toContain('# Palette notes')
  })

  it('reads text and returns inline assets', async () => {
    const home = await fixtureSource.home()
    expect(await fixtureSource.readText(`${home}/readme.md`)).toContain('# Fixture workspace')
    expect(fixtureSource.assetUrl(`${home}/dot.png`)).toContain('dot.png')
    expect(fixtureSource.assetUrl(`${home}/tone.wav`)).toContain('tone.wav')
    expect(fixtureSource.assetUrl(`${home}/clip.mp4`)).toContain('clip.mp4')
  })

  it('refuses to read a binary as text or open it without the desktop app', async () => {
    const home = await fixtureSource.home()
    await expect(fixtureSource.readText(`${home}/dot.png`)).rejects.toThrow(/no text preview/)
    await expect(fixtureSource.openPath(`${home}/dot.png`)).rejects.toThrow(/desktop app/)
    expect(fixtureSource.canOpen).toBe(false)
  })

  it('has a fixture for every viewer kind', async () => {
    const home = await fixtureSource.home()
    const entries = await fixtureSource.readDir(home)
    const viewers = new Set(entries.filter((e) => !e.isDir).map((e) => viewerFor(classifyFile(e.name))))

    for (const kind of ['markdown', 'text', 'code', 'image', 'video', 'audio', 'unsupported'] as const) {
      expect(viewers.has(kind)).toBe(true)
    }
  })

  it('selects the fixture source outside Tauri', () => {
    expect(defaultFileSource().kind).toBe('fixture')
  })
})
