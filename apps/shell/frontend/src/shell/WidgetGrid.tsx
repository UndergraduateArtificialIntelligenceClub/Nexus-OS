import { useEffect, useRef, useState } from 'react'
import { getApp, type AppId } from '@/apps/registry'
import {
  CELL,
  COLS,
  GAP,
  GRID_H,
  GRID_W,
  ROWS,
  SIZE_DIMS,
  SIZE_ORDER,
  fits,
  intersecting,
  offset,
  snapToCell,
  span,
  type Size,
  type Slot,
} from '@/wm/layout'
import { useDesktop, type AppInstance, type DesktopStore } from '@/wm/desktopStore'
import { useAgent } from './agent/agentStore'
import { useHostSlot } from './hostNodes'

// Stage padding on each side of the grid.
const STAGE_PAD = 24
// A press becomes a drag after this many screen pixels of travel.
const DRAG_THRESHOLD = 7
// How close to a card's right or bottom edge (logical px) a press starts a resize.
const EDGE = 14
// Presses on these stay with the app; everything else drags or resizes the card.
const INTERACTIVE =
  'button, a, input, textarea, select, label, [contenteditable="true"], [role="button"], [role="radio"], [role="switch"]'

type PreviewKind = 'free' | 'swap' | 'blocked' | 'resize'
type DragMode = 'move' | 'resize'
type Handle = 'e' | 's' | 'se'

interface Preview {
  slot: Slot
  kind: PreviewKind
  size: Size
}

interface Dragging {
  id: string
  appId: AppId
  size: Size
  col: number
  row: number
  mode: DragMode
  /** Which edge the resize grabs; unused while moving. */
  handle: Handle
  slotEl: HTMLElement
  home: string
  /** Pointer offset from the slot origin, in logical grid pixels. */
  grabX: number
  grabY: number
  startX: number
  startY: number
  pointerId: number
  moved: boolean
}

/** The app's allowed size closest to a wanted span, weighting the dragged axis. */
function snapSize(appId: AppId, wanted: { w: number; h: number }, handle: Handle): Size {
  const wx = handle === 'e' ? 2 : 1
  const wy = handle === 's' ? 2 : 1
  const score = (s: Size) =>
    Math.abs(SIZE_DIMS[s].w - wanted.w) * wx + Math.abs(SIZE_DIMS[s].h - wanted.h) * wy
  return [...getApp(appId).sizes].sort(
    (a, b) => score(a) - score(b) || SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b),
  )[0]
}

/**
 * Snap grid: every open app sits in cells the system picks. Drag a widget by any
 * blank part of its card to move it (free cell, equal-size swap, the orb speaks
 * when a drop doesn't fit), or grab its right or bottom edge to resize — the
 * preview snaps to the sizes that app supports. Cells only position things;
 * the apps themselves render in InstanceHost. Hover chips offer fullscreen,
 * minimize, close — the same store commands the agent speaks.
 */
export function WidgetGrid() {
  const { state, store } = useDesktop()
  const { store: agent } = useAgent()
  const scale = useFitScale(GRID_W, GRID_H)
  const gridRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Dragging | null>(null)
  const previewRef = useRef<Preview | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  // The drag handlers are native listeners attached once; they read the current
  // scale through this ref instead of closing over a stale render's value.
  const scaleRef = useRef(scale)
  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  // Minimized apps leave the grid. A fullscreen app keeps its cell for when it returns.
  const shown = state.instances.filter((it) => it.mode !== 'minimized')
  const dragging = dragId !== null

  // Drag plumbing lives on native listeners: app content is portaled into the
  // slots, so React's synthetic events on a slot never see the app's presses.
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return

    /** The on-screen widgets other than the one in hand. */
    const othersOf = (draggedId: string) =>
      store
        .getState()
        .instances.filter((i) => i.mode !== 'minimized' && !i.exiting && i.id !== draggedId)

    /** What a drop at `slot` would do, given the desk right now. */
    const landKind = (size: Size, slot: Slot, draggedId: string): PreviewKind => {
      const others = othersOf(draggedId)
      if (fits(others, size, slot)) return 'free'
      const hit = intersecting(others, size, slot)
      return hit.length === 1 && hit[0].size === size ? 'swap' : 'blocked'
    }

    const stopListeners = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onUp)
      window.removeEventListener('keydown', onKey)
    }

    // Edge proximity decides the resize cursor while the desk is at rest.
    let hoverSlot: HTMLElement | null = null

    const clearChrome = (drag: Dragging) => {
      drag.slotEl.removeAttribute('data-dragging')
      drag.slotEl.removeAttribute('data-resizing')
      drag.slotEl.style.cursor = ''
      hoverSlot = null
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    const onHover = (e: PointerEvent) => {
      if (dragRef.current) return
      const target = e.target instanceof Element ? e.target : null
      const slotEl = target && grid.contains(target) ? target.closest<HTMLElement>('.nx-slot[data-grab]') : null
      if (hoverSlot && hoverSlot !== slotEl) {
        hoverSlot.style.cursor = ''
        hoverSlot = null
      }
      if (!slotEl) return
      if (target?.closest(INTERACTIVE)) return
      const it = store.getState().instances.find((i) => i.id === slotEl.dataset.slot)
      if (!it || it.mode !== 'widget' || it.exiting) return
      const rect = slotEl.getBoundingClientRect()
      const s = scaleRef.current
      const pxIn = (e.clientX - rect.left) / s
      const pyIn = (e.clientY - rect.top) / s
      const d = SIZE_DIMS[it.size]
      const nearRight = span(d.w) - pxIn <= EDGE
      const nearBottom = span(d.h) - pyIn <= EDGE
      const cursor = nearRight && nearBottom ? 'nwse-resize' : nearRight ? 'ew-resize' : nearBottom ? 'ns-resize' : ''
      if (slotEl.style.cursor !== cursor) slotEl.style.cursor = cursor
      hoverSlot = cursor ? slotEl : null
    }

    function onDown(e: PointerEvent) {
      if (e.button !== 0 || dragRef.current) return
      const target = e.target instanceof Element ? e.target : null
      const slotEl = target?.closest<HTMLElement>('.nx-slot[data-grab]')
      if (!slotEl || !gridRef.current?.contains(slotEl)) return
      if (target?.closest(INTERACTIVE)) return
      const it = store.getState().instances.find((i) => i.id === slotEl.dataset.slot)
      if (!it || it.mode !== 'widget' || it.exiting) return
      const rect = slotEl.getBoundingClientRect()
      const s = scaleRef.current
      const pxIn = (e.clientX - rect.left) / s
      const pyIn = (e.clientY - rect.top) / s
      const d = SIZE_DIMS[it.size]
      const nearRight = span(d.w) - pxIn <= EDGE
      const nearBottom = span(d.h) - pyIn <= EDGE
      const mode: DragMode = nearRight || nearBottom ? 'resize' : 'move'
      const handle: Handle = mode === 'move' ? 'se' : nearRight && nearBottom ? 'se' : nearRight ? 'e' : 's'
      dragRef.current = {
        id: it.id,
        appId: it.appId,
        size: it.size,
        col: it.col,
        row: it.row,
        mode,
        handle,
        slotEl,
        home: slotEl.style.transform,
        grabX: (e.clientX - rect.left) / s,
        grabY: (e.clientY - rect.top) / s,
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
        moved: false,
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      window.addEventListener('blur', onUp)
      window.addEventListener('keydown', onKey)
    }

    function onMove(e: PointerEvent) {
      const drag = dragRef.current
      if (!drag || e.pointerId !== drag.pointerId) return
      const s = scaleRef.current
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return
        drag.moved = true
        drag.slotEl.setAttribute(drag.mode === 'resize' ? 'data-resizing' : 'data-dragging', '')
        document.body.style.userSelect = 'none'
        document.body.style.cursor =
          drag.mode === 'resize'
            ? drag.handle === 'se'
              ? 'nwse-resize'
              : drag.handle === 'e'
                ? 'ew-resize'
                : 'ns-resize'
            : 'grabbing'
        setDragId(drag.id)
      }
      const gridEl = gridRef.current
      if (!gridEl) return
      const gridRect = gridEl.getBoundingClientRect()

      if (drag.mode === 'move') {
        // Carry the real card: the instance div rides inside the slot.
        const dx = (e.clientX - drag.startX) / s
        const dy = (e.clientY - drag.startY) / s
        drag.slotEl.style.transform = `translate(${offset(drag.col) + dx}px, ${offset(drag.row) + dy}px)`
        // Where would the card's origin land, in cells?
        const ox = (e.clientX - gridRect.left) / s - drag.grabX
        const oy = (e.clientY - gridRect.top) / s - drag.grabY
        const d = SIZE_DIMS[drag.size]
        const slot = snapToCell(ox, oy, d.w, d.h)
        const kind = landKind(drag.size, slot, drag.id)
        const cur = previewRef.current
        if (!cur || cur.slot.col !== slot.col || cur.slot.row !== slot.row || cur.kind !== kind) {
          const next: Preview = { slot, kind, size: drag.size }
          previewRef.current = next
          setPreview(next)
        }
        return
      }

      // Resize: the card stays put while the preview snaps to an allowed size.
      const px = (e.clientX - gridRect.left) / s
      const py = (e.clientY - gridRect.top) / s
      const d = SIZE_DIMS[drag.size]
      const pitch = CELL + GAP
      const maxW = Math.min(4, COLS - drag.col)
      const maxH = Math.min(2, ROWS - drag.row)
      // Each cell boundary k sits one gap short of k full pitches, so the edge
      // tracks the pointer exactly at its starting position.
      const wantW =
        drag.handle === 's' ? d.w : Math.max(1, Math.min(maxW, Math.round((px - offset(drag.col) + GAP) / pitch)))
      const wantH =
        drag.handle === 'e' ? d.h : Math.max(1, Math.min(maxH, Math.round((py - offset(drag.row) + GAP) / pitch)))
      const size = snapSize(drag.appId, { w: wantW, h: wantH }, drag.handle)
      const kind: PreviewKind = fits(othersOf(drag.id), size, drag) ? 'resize' : 'blocked'
      const cur = previewRef.current
      if (!cur || cur.size !== size || cur.kind !== kind) {
        const next: Preview = { slot: { col: drag.col, row: drag.row }, kind, size }
        previewRef.current = next
        setPreview(next)
      }
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') finish(true)
    }

    function onUp(e: Event) {
      finish(e.type !== 'pointerup')
    }

    function finish(cancelled: boolean) {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      stopListeners()
      clearChrome(drag)
      setDragId(null)
      const p = previewRef.current
      previewRef.current = null
      setPreview(null)
      if (!drag.moved) return
      if (drag.mode === 'resize') {
        const size = p?.size
        if (cancelled || !size || size === drag.size) return
        const reply = store.setSize(drag.appId, size)
        const after = store.find(drag.appId)
        if (!after || after.exiting || after.size !== size) agent.say(reply)
        return
      }
      const target = p?.slot ?? null
      const back = () => (drag.slotEl.style.transform = drag.home)
      if (cancelled || !target) return back()
      if (target.col === drag.col && target.row === drag.row) return back()
      const reply = store.move(drag.appId, target.col, target.row)
      const after = store.find(drag.appId)
      const ok = !!after && !after.exiting && (after.col !== drag.col || after.row !== drag.row)
      if (ok) {
        // The store write re-renders the slot at its new cell; the transition glides it in.
      } else {
        agent.say(reply)
        back()
      }
    }

    grid.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onHover)
    return () => {
      grid.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onHover)
      if (hoverSlot) hoverSlot.style.cursor = ''
      stopListeners()
    }
  }, [store, agent])

  return (
    <div className="nx-grid-box" style={{ width: GRID_W * scale, height: GRID_H * scale }}>
      <div className="nx-grid" ref={gridRef} style={{ width: GRID_W, height: GRID_H, transform: `scale(${scale})` }}>
        {shown.map((it) => (
          <GridSlot key={it.id} instance={it} store={store} />
        ))}
        {dragging && preview && (
          <div
            className="nx-drop"
            data-kind={preview.kind}
            style={{
              width: span(SIZE_DIMS[preview.size].w),
              height: span(SIZE_DIMS[preview.size].h),
              transform: `translate(${offset(preview.slot.col)}px, ${offset(preview.slot.row)}px)`,
            }}
          />
        )}
      </div>
    </div>
  )
}

function GridSlot({ instance: it, store }: { instance: AppInstance; store: DesktopStore }) {
  const d = SIZE_DIMS[it.size]
  const hosting = it.mode === 'widget'
  const hostRef = useHostSlot(it.id, 'grid')
  return (
    <section
      ref={hosting ? hostRef : undefined}
      className="nx-slot"
      data-slot={it.id}
      data-grab={hosting || undefined}
      aria-label={getApp(it.appId).label}
      aria-hidden={hosting ? undefined : true}
      style={{
        width: span(d.w),
        height: span(d.h),
        transform: `translate(${offset(it.col)}px, ${offset(it.row)}px)`,
      }}
    >
      {hosting && <SlotChips instance={it} store={store} />}
    </section>
  )
}

/** Hover controls for one widget: same commands, same replies, shell-owned chrome. */
function SlotChips({ instance: it, store }: { instance: AppInstance; store: DesktopStore }) {
  const app = getApp(it.appId)
  return (
    <div className="nx-slot-chips" role="toolbar" aria-label={`${app.label} controls`}>
      {app.fullscreen && (
        <button
          type="button"
          aria-label={it.mode === 'fullscreen' ? `leave ${app.label} fullscreen` : `${app.label} fullscreen`}
          onClick={() => (it.mode === 'fullscreen' ? store.exitFullscreen() : store.fullscreen(it.appId))}
        >
          {it.mode === 'fullscreen' ? 'v' : '^'}
        </button>
      )}
      <button type="button" aria-label={`minimize ${app.label}`} onClick={() => store.minimize(it.appId)}>
        _
      </button>
      <button type="button" aria-label={`close ${app.label}`} onClick={() => store.close(it.appId)}>
        x
      </button>
    </div>
  )
}

/** Room the chrome takes above and below the stage, from the theme tokens. */
function chromeRoom() {
  const css = getComputedStyle(document.documentElement)
  const top = parseFloat(css.getPropertyValue('--chrome-top')) || 40
  const bottom = parseFloat(css.getPropertyValue('--chrome-bottom')) || 72
  return top + bottom
}

/** Scales the grid to fit the window: down when tight, up to a gentle cap on large screens. */
const MAX_SCALE = 1.35
function useFitScale(w: number, h: number) {
  const calc = () =>
    Math.max(
      0.3,
      Math.min(
        MAX_SCALE,
        (window.innerWidth - STAGE_PAD * 2) / w,
        (window.innerHeight - chromeRoom() - STAGE_PAD * 2) / h,
      ),
    )
  const [scale, setScale] = useState(calc)
  useEffect(() => {
    const onResize = () => setScale(calc())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return scale
}
