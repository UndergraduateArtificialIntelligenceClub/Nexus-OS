import { EmptyState, VideoPlayer, type VideoDensity } from '@/ui'
import type { AppProps } from '@/apps/types'
import { useMedia } from '@/apps/mediaInbox'
import type { Size } from '@/wm/layout'
import './video.css'

// The video widget: plays whatever was last sent to it through the media inbox
// (the browser's "open as widget" today, the engine's widget payloads later).
// The player lives in @/ui; this app only maps the cell size to how much
// control fits.

export function densityFor(size: Size, mode: AppProps['mode']): VideoDensity {
  if (mode === 'fullscreen') return 'full'
  if (size === '1x1') return 'min'
  if (size === '2x1') return 'bar'
  return 'full'
}

export function VideoApp({ size, mode }: AppProps) {
  const video = useMedia('video')
  if (!video) return <EmptyState className="w-video-empty" hint="open a video from the browser" />
  return <VideoPlayer className="w-video" src={video.src} poster={video.poster} source={video.source} density={densityFor(size, mode)} mode={mode} />
}
