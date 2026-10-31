import { useEffect, useState } from 'react'
import { getApp } from '@/apps/registry'
import { AsciiFrame } from '@/ui'
import { GRID_H, GRID_W, SIZE_DIMS, offset, span } from '@/wm/layout'
import { useDesktop, type AppInstance } from '@/wm/desktopStore'
import { AppHost } from './AppHost'

// Apps open at launch build in one after another.
const INTRO_START = 150
const INTRO_STEP = 200

// Room the grid leaves around itself: stage padding and the prompt bar below.
const SIDE_ROOM = 48
const VERTICAL_ROOM = 190

/** Snap grid: every open app sits in cells the system picks. No dragging or free resizing. */
export function WidgetGrid() {
  const { state, store } = useDesktop()
  const scale = useFitScale(GRID_W, GRID_H)
  const [introDelays] = useState(
    () => new Map(state.instances.map((it, n) => [it.id, INTRO_START + n * INTRO_STEP] as const)),
  )

  // Minimized apps leave the grid. Fullscreen apps show in their cell until FullscreenHost exists.
  const shown = state.instances.filter((it) => it.mode !== 'minimized')

  return (
    <div className="nx-grid-box" style={{ width: GRID_W * scale, height: GRID_H * scale }}>
      <div className="nx-grid" style={{ width: GRID_W, height: GRID_H, transform: `scale(${scale})` }}>
        {shown.map((it) => (
          <GridSlot
            key={it.id}
            instance={it}
            delay={introDelays.get(it.id) ?? 0}
            onFocus={() => store.focus(it.id)}
            onExited={() => store.remove(it.id)}
          />
        ))}
      </div>
    </div>
  )
}

interface GridSlotProps {
  instance: AppInstance
  delay: number
  onFocus: () => void
  onExited: () => void
}

function GridSlot({ instance: it, delay, onFocus, onExited }: GridSlotProps) {
  const d = SIZE_DIMS[it.size]
  const { label } = getApp(it.appId)
  return (
    <section
      className="nx-slot"
      aria-label={label}
      onPointerDown={onFocus}
      onFocus={onFocus}
      style={{
        width: span(d.w),
        height: span(d.h),
        transform: `translate(${offset(it.col)}px, ${offset(it.row)}px)`,
      }}
    >
      <AsciiFrame
        phase={it.exiting ? 'exit' : 'enter'}
        delay={delay}
        label={label}
        moveKey={`${it.col},${it.row},${it.size}`}
        onExited={onExited}
      >
        <AppHost instance={it} />
      </AsciiFrame>
    </section>
  )
}

/** Shrinks the grid to fit small windows; never scales it up. */
function useFitScale(w: number, h: number) {
  const calc = () =>
    Math.max(0.3, Math.min(1, (window.innerWidth - SIDE_ROOM) / w, (window.innerHeight - VERTICAL_ROOM) / h))
  const [scale, setScale] = useState(calc)
  useEffect(() => {
    const onResize = () => setScale(calc())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return scale
}
