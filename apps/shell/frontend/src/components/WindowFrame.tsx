import { WindowState } from '@/types/WindowState'

interface WindowFrameProps {
  window: WindowState
  onMove: (id: string, x: number, y: number) => void
  onResize: (id: string, w: number, h: number) => void
}

export function WindowFrame({ window, onMove, onResize }: WindowFrameProps) {
  return (
    <div
      className="nexus-window-frame"
      style={{
        left: window.x,
        top: window.y,
        width: window.width,
        height: window.height,
        zIndex: window.zIndex,
      }}
    >
      <div className="nexus-window-titlebar">{window.title}</div>
      <div className="nexus-window-content" />
    </div>
  )
}
