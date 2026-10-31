import { useEffect, useRef } from 'react'
import { APP_IDS, getApp, type AppId } from '@/apps/registry'
import { useReducedMotion } from '@/theme'
import { AsciiFrame, ENTER_MS, type Phase } from '@/ui'
import { SIZE_ORDER, type Size } from '@/wm/layout'
import { useDesktop } from '@/wm/desktopStore'

interface TrayProps {
  phase: Phase
  onPick: (appId: AppId, size?: Size) => void
  onHide: (appId: AppId) => void
  onClosed: () => void
}

/**
 * Fallback to the agent: a list of every app, opened with ⌘/Ctrl+K. Builds in like any widget.
 * Interim: Spotlight replaces this (with the app gallery) in the next step.
 */
export function Tray({ phase, onPick, onHide, onClosed }: TrayProps) {
  const { store } = useDesktop()
  const reduced = useReducedMotion()
  const firstRef = useRef<HTMLButtonElement>(null)

  // Content is inert while it types in, so focus once it has settled.
  useEffect(() => {
    if (phase !== 'enter') return
    const id = window.setTimeout(() => firstRef.current?.focus(), reduced ? 0 : ENTER_MS)
    return () => window.clearTimeout(id)
  }, [phase, reduced])

  return (
    <div className="nx-tray" role="dialog" aria-label="Apps">
      <AsciiFrame phase={phase} label="apps" fluid onExited={onClosed}>
        <ul className="nx-tray-list">
          {APP_IDS.map((appId, idx) => {
            const def = getApp(appId)
            const current = store.find(appId)
            return (
              <li key={appId} className="nx-tray-row">
                <span className="nx-tray-name">{def.label}</span>
                <span className="nx-tray-sizes" role="group" aria-label={`${def.label} size`}>
                  {SIZE_ORDER.map((size) => (
                    <button
                      key={size}
                      type="button"
                      className="chip"
                      disabled={!def.sizes.includes(size)}
                      aria-pressed={current?.size === size}
                      onClick={() => onPick(appId, size)}
                    >
                      {size}
                    </button>
                  ))}
                </span>
                <button
                  ref={idx === 0 ? firstRef : undefined}
                  type="button"
                  className="chip chip--action"
                  onClick={() => (current ? onHide(appId) : onPick(appId))}
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
