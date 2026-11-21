// Multi-widget layout sign-off (issue #32).
//
// Drives the real desktop store through mixed multi-widget sessions and checks
// the grid invariants (bounds, no overlaps, legal sizes, one fullscreen, valid
// focus) plus a relaunch round-trip after EVERY action. Drag and resize are
// covered at the store level (move / setSize are what WidgetGrid calls); the
// pointer and visual side is a manual checklist in docs/ui-library/plan.md.

import { beforeEach, describe, expect, it } from 'vitest'
import { APP_IDS, getApp, type AppId } from '@/apps/registry'
import { COLS, ROWS, SIZE_ORDER, type Size } from './layout'
import {
  createDesktopStore,
  defaultDesktop,
  loadDesktop,
  type AppInstance,
  type DesktopState,
  type DesktopStore,
} from './desktopStore'
import { assertValidDesk, checkInvariants, savedForm } from './testing/gridInvariants'

beforeEach(() => {
  localStorage.clear()
})

const STORAGE_KEY = 'nexus-desktop-v1'
const EMPTY: DesktopState = { instances: [], focusedId: null }

/** Replies that mean "nothing happened": the desk must be byte-for-byte unchanged. */
const REFUSAL =
  /no room|not enough room|isn't open|can't be|restore it first|fullscreen right now|doesn't have a fullscreen|nothing is fullscreen|nothing to close|already (tidy|there|minimized|fullscreen|\d)/

const snapshot = (s: DesktopState) => JSON.stringify(savedForm(s))
const pos = (it: AppInstance) => `${it.col},${it.row}`

/**
 * Wraps a store so every command is followed by the invariant + relaunch checks
 * and the command's own post-condition. `log` collects a replayable trace.
 */
function harness(initial: DesktopState) {
  // Start from a desk that was saved on a previous visit, so a refusal on the very
  // first step (which writes nothing) still relaunches to the same desk.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedForm(initial)))
  let store: DesktopStore = createDesktopStore(initial)
  const log: string[] = []
  let step = 0

  const context = (what: string) => `step ${step} ${what}\n  recent: ${log.slice(-10).join(' | ')}`

  /** Runs one store command, checks everything, returns its reply. */
  function run(what: string, act: (s: DesktopStore) => string | void): string {
    step++
    const before = store.getState()
    const reply = act(store) ?? ''
    const after = store.getState()
    log.push(`${what} -> ${reply}`)
    assertValidDesk(after, context(what))

    if (REFUSAL.test(reply) && snapshot(before) !== snapshot(after)) {
      throw new Error(`refusal changed the desk: ${context(what)}`)
    }
    return reply
  }

  /** move(): only the dragged widget and at most one blocker change cells; nothing else changes. */
  function move(appId: AppId, col: number, row: number) {
    const before = store.getState().instances
    const reply = run(`move ${appId} ${col},${row}`, (s) => s.move(appId, col, row))
    const after = store.getState().instances
    const moved = after.filter((a) => {
      const b = before.find((x) => x.id === a.id)
      return b && pos(a) !== pos(b)
    })
    if (moved.length > 2) throw new Error(`move reshuffled ${moved.length} widgets: ${context(`move ${appId}`)}`)
    for (const a of after) {
      const b = before.find((x) => x.id === a.id)
      if (b && (a.size !== b.size || a.mode !== b.mode)) throw new Error(`move changed size/mode of ${a.appId}`)
    }
    return reply
  }

  /** setSize(): only the target widget changes. */
  function setSize(appId: AppId, size: Size) {
    const before = store.getState().instances
    const reply = run(`setSize ${appId} ${size}`, (s) => s.setSize(appId, size))
    const after = store.getState().instances
    const target = store.find(appId)?.id
    for (const a of after) {
      if (a.id === target) continue
      const b = before.find((x) => x.id === a.id)
      if (b && JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`setSize ${appId} disturbed ${a.appId}`)
    }
    return reply
  }

  /** Simulates closing the app: a new store from whatever was saved. */
  function relaunch() {
    step++
    const saved = snapshot(store.getState())
    store = createDesktopStore(loadDesktop())
    log.push('relaunch')
    expect(snapshot(store.getState())).toBe(saved)
    assertValidDesk(store.getState(), context('relaunch'))
  }

  return {
    run,
    move,
    setSize,
    relaunch,
    get store() {
      return store
    },
    get steps() {
      return step
    },
  }
}

/** Seeded PRNG (mulberry32): the same seed replays the same session. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------

describe('A. scripted multi-widget pass (7 mixed widgets)', () => {
  it('keeps every invariant through fullscreen, minimize, drag, resize, tidy and relaunch', () => {
    const h = harness(EMPTY)
    const at = (id: AppId) => {
      const it = h.store.find(id)!
      return { col: it.col, row: it.row, size: it.size, mode: it.mode }
    }

    // Open seven widgets of five different footprints.
    expect(h.run('open clock', (s) => s.open('clock', '2x2'))).toMatch(/placed/)
    expect(h.run('open browser', (s) => s.open('browser', '2x2'))).toMatch(/placed/)
    expect(h.run('open notes', (s) => s.open('notes', '2x1'))).toMatch(/placed/)
    expect(h.run('open terminal', (s) => s.open('terminal', '2x1'))).toMatch(/placed/)
    expect(h.run('open gallery', (s) => s.open('gallery', '1x2'))).toMatch(/placed/)
    expect(h.run('open timer', (s) => s.open('timer', '1x1'))).toMatch(/placed/)
    expect(h.run('open monitor', (s) => s.open('monitor', '1x1'))).toMatch(/placed/)

    // The documented starting board.
    expect(at('clock')).toMatchObject({ col: 0, row: 0, size: '2x2' })
    expect(at('browser')).toMatchObject({ col: 2, row: 0, size: '2x2' })
    expect(at('notes')).toMatchObject({ col: 4, row: 0, size: '2x1' })
    expect(at('terminal')).toMatchObject({ col: 4, row: 1, size: '2x1' })
    expect(at('gallery')).toMatchObject({ col: 0, row: 2, size: '1x2' })
    expect(at('timer')).toMatchObject({ col: 1, row: 2 })
    expect(at('monitor')).toMatchObject({ col: 2, row: 2 })
    expect(h.store.getState().instances).toHaveLength(7)

    // Fullscreen keeps the cell; a second fullscreen demotes the first.
    expect(h.run('fullscreen browser', (s) => s.fullscreen('browser'))).toMatch(/is fullscreen/)
    expect(h.run('fullscreen notes', (s) => s.fullscreen('notes'))).toMatch(/is fullscreen/)
    expect(at('browser').mode).toBe('widget')
    expect(h.run('fullscreen clock', (s) => s.fullscreen('clock'))).toMatch(/doesn't have a fullscreen/)
    expect(h.run('exit fullscreen', (s) => s.exitFullscreen())).toMatch(/back to the grid/)
    expect(at('notes')).toMatchObject({ col: 4, row: 0, mode: 'widget' })

    // Minimize frees the cells; restore returns to the same spot.
    expect(h.run('minimize notes', (s) => s.minimize('notes'))).toMatch(/minimized/)
    expect(h.run('minimize notes again', (s) => s.minimize('notes'))).toMatch(/already minimized/)
    expect(h.run('restore notes', (s) => s.restore('notes'))).toMatch(/restored/)
    expect(at('notes')).toMatchObject({ col: 4, row: 0, mode: 'widget' })

    // Drag: free cell, equal-size swap, step-aside, blocked, locked.
    expect(h.move('gallery', 5, 2)).toMatch(/moved gallery/)
    expect(h.move('timer', 2, 2)).toMatch(/swapped/)
    expect(at('timer')).toMatchObject({ col: 2, row: 2 })
    expect(at('monitor')).toMatchObject({ col: 1, row: 2 })
    // A lone, different-size blocker steps aside to the first free spot.
    expect(h.move('monitor', 0, 0)).toMatch(/moved system; clock stepped aside/)
    expect(at('monitor')).toMatchObject({ col: 0, row: 0 })
    expect(at('clock')).toMatchObject({ col: 0, row: 1 }) // first 2x2 gap in reading order
    // Several blockers: refused, desk unchanged (terminal would cover browser + notes).
    expect(h.move('terminal', 3, 0)).toMatch(/no room/)
    // Off-board targets clamp onto the board.
    expect(h.move('gallery', 99, 99)).toMatch(/already there|moved gallery/)
    expect(at('gallery')).toMatchObject({ col: 5, row: 2 })

    h.relaunch()

    // Resize: in place, blocked, and a ladder step that forces a repack.
    // Board now: monitor (0,0), clock 2x2 (0,1), browser 2x2 (2,0), notes (4,0),
    // terminal (4,1), timer (2,2), gallery 1x2 (5,2).
    expect(h.setSize('timer', '2x1')).toMatch(/is now 2x1/)
    expect(h.setSize('monitor', '2x1')).toMatch(/is now 2x1/)
    expect(h.setSize('gallery', '2x2')).toMatch(/not enough room/) // would run off the right edge
    expect(h.setSize('clock', '4x2')).toMatch(/can't be/)
    // No free 2x2 gap is left, so the ladder step repacks the desk.
    expect(h.run('resize terminal up', (s) => s.resize('terminal', 'up'))).toMatch(/rearranged to make terminal 2x2/)
    expect(h.run('resize terminal up again', (s) => s.resize('terminal', 'up'))).toMatch(/4x2|not enough room/)

    // Moves are refused while fullscreen or minimized.
    h.run('fullscreen browser', (s) => s.fullscreen('browser'))
    expect(h.move('browser', 0, 2)).toMatch(/fullscreen right now/)
    h.run('exit fullscreen', (s) => s.exitFullscreen())
    h.run('minimize clock', (s) => s.minimize('clock'))
    expect(h.move('clock', 0, 2)).toMatch(/restore it first/)
    h.run('resize minimized clock', (s) => s.resize('clock', '1x1'))
    expect(h.run('restore clock', (s) => s.restore('clock'))).toMatch(/restored|no room/)

    // Tidy is idempotent.
    h.run('tidy', (s) => s.tidy())
    expect(h.run('tidy again', (s) => s.tidy())).toBe('already tidy.')

    h.relaunch()

    // Close with the exit animation still running: its cells are free right away.
    h.run('close gallery (animating)', (s) => s.close('gallery'))
    const exiting = h.store.getState().instances.find((i) => i.appId === 'gallery')!
    expect(exiting.exiting).toBe(true)
    expect(h.run('reopen gallery mid-exit', (s) => s.open('gallery'))).toMatch(/placed|made room/)
    h.run('animation done', (s) => s.remove(exiting.id))
    h.run('close timer', (s) => s.close('timer'))
    h.run('close all', (s) => s.closeAll())
    expect(h.run('close all again', (s) => s.closeAll())).toBe('nothing to close.')

    expect(h.steps).toBeGreaterThan(40)
  })
})

describe('B. dense desk (default layout, 11 widgets)', () => {
  it('packs, fullscreens, minimizes and tidies a nearly full board without breaking invariants', () => {
    const h = harness(defaultDesktop())
    // Nothing is saved until the first command, so only the grid invariants apply here.
    expect(checkInvariants(h.store.getState())).toEqual([])
    const cells = () =>
      h.store
        .getState()
        .instances.filter((i) => i.mode !== 'minimized' && !i.exiting)
        .reduce((n, i) => n + Number(i.size[0]) * Number(i.size[2]), 0)
    expect(cells()).toBeGreaterThanOrEqual(22)

    expect(h.run('open calc', (s) => s.open('calc'))).toMatch(/placed|made room|no room/)
    expect(h.run('grow browser', (s) => s.resize('browser', '4x2'))).toMatch(/4x2|not enough room/)
    h.run('fullscreen gallery', (s) => s.fullscreen('gallery'))
    h.run('fullscreen files', (s) => s.fullscreen('files'))
    h.run('minimize clock', (s) => s.minimize('clock'))
    h.run('minimize terminal', (s) => s.minimize('terminal'))
    h.run('tidy', (s) => s.tidy())
    h.relaunch()
    h.run('restore clock', (s) => s.restore('clock'))
    h.run('restore terminal', (s) => s.restore('terminal'))
    h.run('exit fullscreen', (s) => s.exitFullscreen())
    for (let col = 0; col < COLS; col++) h.move('settings', col, ROWS - 1)
    h.run('tidy', (s) => s.tidy())
    h.relaunch()
  })
})

describe('C. seeded random sessions', () => {
  const SEEDS = 20
  const STEPS = 300

  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`seed ${seed}: ${STEPS} random actions keep every invariant`, () => {
      const rand = rng(seed)
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]
      const h = harness(rand() < 0.5 ? EMPTY : defaultDesktop())
      // Closed widgets whose exit animation hasn't finished yet.
      let pending: string[] = []
      const openApp = (): AppId | null => {
        const live = h.store.getState().instances.filter((i) => !i.exiting)
        return live.length ? pick(live).appId : null
      }

      for (let i = 0; i < STEPS; i++) {
        const roll = rand()
        const app = pick(APP_IDS)
        const target = openApp() ?? app
        if (roll < 0.14) {
          const size = rand() < 0.5 ? pick(SIZE_ORDER) : undefined
          h.run(`open ${app} ${size ?? ''}`, (s) => s.open(app, size))
        } else if (roll < 0.22) {
          const before = h.store.find(target)
          h.run(`close ${target}`, (s) => s.close(target))
          const after = h.store.getState().instances.find((x) => x.id === before?.id)
          if (after?.exiting) {
            if (rand() < 0.5) h.run(`remove ${after.id}`, (s) => s.remove(after.id))
            else pending.push(after.id)
          }
        } else if (roll < 0.26 && pending.length) {
          const ids = pending
          pending = []
          for (const id of ids) h.run(`remove ${id}`, (s) => s.remove(id))
        } else if (roll < 0.33) {
          h.run(`minimize ${target}`, (s) => s.minimize(target))
        } else if (roll < 0.4) {
          h.run(`restore ${target}`, (s) => s.restore(target))
        } else if (roll < 0.46) {
          h.run(`fullscreen ${target}`, (s) => s.fullscreen(target))
        } else if (roll < 0.5) {
          h.run('exitFullscreen', (s) => s.exitFullscreen())
        } else if (roll < 0.66) {
          // Includes off-board targets so the clamp is exercised.
          h.move(target, Math.floor(rand() * (COLS + 2)) - 1, Math.floor(rand() * (ROWS + 2)) - 1)
        } else if (roll < 0.76) {
          h.setSize(target, pick(SIZE_ORDER))
        } else if (roll < 0.84) {
          const req = pick(['up', 'down', ...SIZE_ORDER] as const)
          h.run(`resize ${target} ${req}`, (s) => s.resize(target, req))
        } else if (roll < 0.89) {
          h.run('tidy', (s) => s.tidy())
        } else if (roll < 0.94) {
          const it = h.store.getState().instances.find((x) => x.appId === target && !x.exiting)
          if (it) h.run(`focus ${target}`, (s) => s.focus(it.id))
        } else if (roll < 0.97) {
          pending = [] // exit animations don't survive a relaunch
          h.relaunch()
        } else {
          h.run('closeAll', (s) => s.closeAll())
        }
      }
      // Some rolls are no-ops (e.g. focus with nothing open); most must run.
      expect(h.steps).toBeGreaterThan(STEPS * 0.9)
    })
  }
})

describe('D. the checker catches broken desks', () => {
  const mk = (
    id: string,
    appId: AppId,
    size: Size,
    col: number,
    row: number,
    mode: AppInstance['mode'] = 'widget',
  ): AppInstance => ({ id, appId, size, col, row, mode })
  const errorsFor = (instances: AppInstance[], focusedId: string | null = null) =>
    checkInvariants({ instances, focusedId }).join('\n')

  it('accepts a sound desk', () => {
    expect(checkInvariants(defaultDesktop())).toEqual([])
  })

  it('flags overlapping widgets', () => {
    expect(errorsFor([mk('a', 'clock', '2x2', 0, 0), mk('b', 'timer', '1x1', 1, 1)])).toMatch(/overlap/)
  })

  it('counts a fullscreen widget as still holding its cell', () => {
    expect(errorsFor([mk('a', 'notes', '2x1', 0, 0, 'fullscreen'), mk('b', 'timer', '1x1', 1, 0)])).toMatch(/overlap/)
  })

  it('ignores minimized and exiting widgets for overlap', () => {
    expect(
      errorsFor([
        mk('a', 'clock', '2x2', 0, 0),
        mk('b', 'timer', '1x1', 1, 1, 'minimized'),
        { ...mk('c', 'monitor', '1x1', 0, 0), exiting: true },
      ]),
    ).toBe('')
  })

  it('flags widgets off the board', () => {
    expect(errorsFor([mk('a', 'clock', '2x2', COLS - 1, 0)])).toMatch(/out of bounds/)
    expect(errorsFor([mk('a', 'timer', '1x1', 0, -1)])).toMatch(/out of bounds/)
  })

  it('flags sizes the app does not declare', () => {
    expect(getApp('clock').sizes).not.toContain('4x2')
    expect(errorsFor([mk('a', 'clock', '4x2', 0, 0)])).toMatch(/illegal size/)
  })

  it('flags duplicate apps and ids', () => {
    expect(errorsFor([mk('a', 'timer', '1x1', 0, 0), mk('b', 'timer', '1x1', 1, 0)])).toMatch(/open twice/)
    expect(errorsFor([mk('a', 'timer', '1x1', 0, 0), mk('a', 'monitor', '1x1', 1, 0)])).toMatch(/duplicate instance id/)
  })

  it('flags two fullscreen apps and fullscreen without a view', () => {
    expect(
      errorsFor([mk('a', 'notes', '2x1', 0, 0, 'fullscreen'), mk('b', 'files', '2x1', 2, 0, 'fullscreen')]),
    ).toMatch(/2 apps fullscreen/)
    expect(errorsFor([mk('a', 'clock', '2x2', 0, 0, 'fullscreen')])).toMatch(/without a fullscreen view/)
  })

  it('flags focus on a missing or exiting widget', () => {
    expect(errorsFor([mk('a', 'timer', '1x1', 0, 0)], 'ghost')).toMatch(/focus/)
    expect(errorsFor([{ ...mk('a', 'timer', '1x1', 0, 0), exiting: true }], 'a')).toMatch(/focus/)
  })

  it('flags a desk that would not survive a relaunch', () => {
    const store = createDesktopStore(defaultDesktop())
    localStorage.setItem(STORAGE_KEY, 'not json')
    expect(() => assertValidDesk(store.getState(), 'corrupted storage')).toThrow(/relaunch differs/)
  })
})
