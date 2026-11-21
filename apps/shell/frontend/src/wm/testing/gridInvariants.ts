// Grid invariants for the widget desk (issue #32). Pure checks over DesktopState,
// so any test that drives the desktop store can assert the desk is still sound.
//
// The checks walk cells directly instead of calling layout.ts helpers, so they
// don't share bugs with the code they verify.

import { getApp } from '@/apps/registry'
import { COLS, ROWS, SIZE_DIMS } from '../layout'
import { loadDesktop, type AppInstance, type DesktopState } from '../desktopStore'

const live = (s: DesktopState) => s.instances.filter((i) => !i.exiting)
/** Instances holding grid cells. A fullscreen app keeps its cell for when it returns. */
const onGrid = (s: DesktopState) => live(s).filter((i) => i.mode !== 'minimized')

const label = (it: AppInstance) => `${it.appId}#${it.id} ${it.size}@(${it.col},${it.row})`

/** Every broken invariant as a readable message. Empty means the desk is sound. */
export function checkInvariants(state: DesktopState): string[] {
  const errors: string[] = []

  // 1 + 2. Bounds and overlaps.
  const owner = new Map<string, AppInstance>()
  for (const it of onGrid(state)) {
    const d = SIZE_DIMS[it.size]
    if (!d) continue // reported as an illegal size below
    if (it.col < 0 || it.row < 0 || it.col + d.w > COLS || it.row + d.h > ROWS) {
      errors.push(`out of bounds: ${label(it)} on a ${COLS}x${ROWS} grid`)
    }
    for (let r = it.row; r < it.row + d.h; r++)
      for (let c = it.col; c < it.col + d.w; c++) {
        const key = `${c},${r}`
        const prev = owner.get(key)
        if (prev) errors.push(`overlap at cell (${c},${r}): ${label(prev)} and ${label(it)}`)
        else owner.set(key, it)
      }
  }

  // 3. Every live instance (minimized too) has a size its app declares.
  for (const it of live(state)) {
    if (!getApp(it.appId).sizes.includes(it.size)) errors.push(`illegal size: ${label(it)}`)
  }

  // 4. Unique ids, and at most one live instance per app.
  const ids = new Set<string>()
  for (const it of state.instances) {
    if (ids.has(it.id)) errors.push(`duplicate instance id: ${it.id}`)
    ids.add(it.id)
  }
  const apps = new Set<string>()
  for (const it of live(state)) {
    if (apps.has(it.appId)) errors.push(`app open twice: ${it.appId}`)
    apps.add(it.appId)
  }

  // 5. At most one fullscreen app, and only apps that have a fullscreen view.
  const full = live(state).filter((i) => i.mode === 'fullscreen')
  if (full.length > 1) errors.push(`${full.length} apps fullscreen: ${full.map(label).join(', ')}`)
  for (const it of full) {
    if (!getApp(it.appId).fullscreen) errors.push(`fullscreen without a fullscreen view: ${label(it)}`)
  }

  // 6. Focus points at a live instance, or nothing.
  if (state.focusedId !== null && !live(state).some((i) => i.id === state.focusedId)) {
    errors.push(`focus points at a missing or exiting instance: ${state.focusedId}`)
  }

  return errors
}

/** What a relaunch should read back: live instances without animation flags. */
export function savedForm(state: DesktopState): DesktopState {
  return {
    instances: live(state).map(({ exiting: _, ...rest }) => rest),
    focusedId: state.focusedId,
  }
}

/** Mismatches between the live desk and what a relaunch would load from storage. */
export function checkPersistence(state: DesktopState): string[] {
  const expected = JSON.stringify(savedForm(state))
  const reloaded = JSON.stringify(loadDesktop())
  return expected === reloaded ? [] : [`relaunch differs:\n  live:     ${expected}\n  reloaded: ${reloaded}`]
}

/** Throws with every violation (invariants + persistence) and `context` for the failure log. */
export function assertValidDesk(state: DesktopState, context = ''): void {
  const errors = [...checkInvariants(state), ...checkPersistence(state)]
  if (errors.length) throw new Error(`desk invariants broken${context ? ` after ${context}` : ''}:\n- ${errors.join('\n- ')}`)
}
