import { useEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react'
import type { AppMode } from '@/apps/types'
import { AsciiSlider } from '../ascii/AsciiSlider'
import { IconButton } from '../components/Button'
import { MediaSurface, type MediaPhase } from './MediaSurface'
import { SourceBadge } from './SourceBadge'
import { useMediaLifecycle } from './useMediaLifecycle'

// VideoPlayer: an HTML5 <video> with the shell's own controls. Mono glyphs, the
// ASCII meter as the scrubber and the volume, and a tabular timecode. It never
// autoplays and always sleeps when its widget is minimized or offscreen
// (useMediaLifecycle). Every reading comes from the element's own events, never
// assumed, so what the controls say is what the video is doing.
//
// Keyboard, once focus is anywhere in the player: Space or K plays and pauses,
// ← / → seek 5s, ↑ / ↓ change the volume, M mutes. Esc belongs to the shell.

export type VideoDensity = 'min' | 'bar' | 'full'

export interface VideoPlayerProps {
  src: string
  poster?: string
  /** What the video is, for the accessible name. */
  title?: string
  source?: string
  /**
   * How much control fits: `min` is play and time (1x1), `bar` sits the controls
   * beside the picture (2x1), `full` puts every control under it.
   */
  density?: VideoDensity
  /** The instance's mode from AppProps, so the video sleeps with its widget. */
  mode: AppMode
  className?: string
}

const SEEK_STEP = 5
const VOLUME_STEP = 0.1
/** JetBrains Mono's advance at the meter's 12px: 0.6em. */
const CHAR_PX = 7.2

/** `m:ss`, or `h:mm:ss` past an hour. Unknown reads as `-:--`. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '-:--'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function VideoPlayer({ src, poster, title = 'video', source, density = 'full', mode, className }: VideoPlayerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [phase, setPhase] = useState<MediaPhase>(src ? 'loading' : 'empty')
  const [paused, setPaused] = useState(true)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)

  // A different clip starts over: loading, at zero, paused.
  const [shown, setShown] = useState(src)
  if (src !== shown) {
    setShown(src)
    setPhase(src ? 'loading' : 'empty')
    setPaused(true)
    setTime(0)
    setDuration(0)
  }

  useMediaLifecycle({ mode, media: video, rootRef })

  const ready = phase === 'ready' && !!video
  // Live streams report Infinity: no scrubbing, and the timecode says it doesn't know.
  const length = Number.isFinite(duration) ? duration : 0

  const toggle = () => {
    if (!ready) return
    if (paused) {
      const p = video.play()
      // A refused play (no gesture, decode error) leaves it paused; the event says so.
      if (p) p.catch(() => setPaused(true))
    } else video.pause()
  }

  const seek = (t: number) => {
    if (!ready || !(length > 0)) return
    const next = clamp(t, 0, length)
    video.currentTime = next
    setTime(next)
  }

  const changeVolume = (v: number) => {
    if (!video) return
    const next = clamp(Math.round(v * 100) / 100, 0, 1)
    video.volume = next
    setVolume(next)
    // Turning it up is a request to hear it.
    if (next > 0 && video.muted) {
      video.muted = false
      setMuted(false)
    }
  }

  const toggleMute = () => {
    if (!video) return
    video.muted = !muted
    setMuted(!muted)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    // Space on a focused button already presses it.
    if (e.key === ' ' && e.target instanceof HTMLButtonElement) return
    const keys: Record<string, () => void> = {
      ' ': toggle,
      k: toggle,
      ArrowLeft: () => seek(time - SEEK_STEP),
      ArrowRight: () => seek(time + SEEK_STEP),
      ArrowUp: () => changeVolume((muted ? 0 : volume) + VOLUME_STEP),
      ArrowDown: () => changeVolume((muted ? 0 : volume) - VOLUME_STEP),
      m: toggleMute,
    }
    const run = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key]
    if (!run) return
    e.preventDefault()
    run()
  }

  const fromElement = (e: SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget
    setVolume(v.volume)
    setMuted(v.muted)
  }

  // The scrubber is as wide as the room it has, in whole characters.
  const seekBox = useRef<HTMLSpanElement>(null)
  const seekChars = useFitChars(seekBox, density === 'min' ? 0 : 10)

  const timecode = (
    <span className="nx-video-time">
      {formatTime(time)}
      <span className="nx-video-dur"> / {formatTime(length || NaN)}</span>
    </span>
  )

  const play = (
    <IconButton label={paused ? 'play' : 'pause'} className="nx-video-btn" onClick={toggle} disabled={!ready}>
      {paused ? '>' : '||'}
    </IconButton>
  )

  const scrubber = (
    <span className="nx-video-seek" ref={seekBox}>
      <AsciiSlider
        label="seek"
        value={time}
        max={length}
        step={SEEK_STEP}
        width={seekChars}
        formatValue={(v) => `${formatTime(v)} of ${formatTime(length || NaN)}`}
        onChange={seek}
        disabled={!ready}
      />
    </span>
  )

  const sound = (
    <span className="nx-video-sound">
      <IconButton label={muted ? 'unmute' : 'mute'} className="nx-video-btn" onClick={toggleMute} disabled={!video}>
        {muted ? '<x' : '<)'}
      </IconButton>
      <AsciiSlider
        label="volume"
        value={muted ? 0 : volume}
        max={1}
        step={VOLUME_STEP}
        width={density === 'full' ? 8 : 6}
        formatValue={(v) => (muted ? 'muted' : `${Math.round(v * 100)}%`)}
        onChange={changeVolume}
        disabled={!video}
      />
    </span>
  )

  const badge = source ? <SourceBadge source={source} className="nx-source nx-video-source" /> : null

  return (
    <div
      ref={rootRef}
      className={className ? `nx-video ${className}` : 'nx-video'}
      data-density={density}
      role="group"
      aria-label={`${title}, video player`}
      onKeyDown={onKeyDown}
    >
      <MediaSurface
        alt={title}
        state={phase}
        className="nx-media nx-video-surface"
        message="couldn't play this video."
        onRetry={() => {
          setPhase('loading')
          video?.load()
        }}
        media={
          src ? (
            <video
              ref={setVideo}
              className="nx-video-el"
              src={src}
              poster={poster}
              preload="metadata"
              playsInline
              // The picture is a big play button, the way every player works.
              onClick={toggle}
              onLoadedMetadata={(e) => {
                setDuration(e.currentTarget.duration)
                fromElement(e)
                setPhase('ready')
              }}
              onDurationChange={(e) => setDuration(e.currentTarget.duration)}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onPlay={() => setPaused(false)}
              onPause={() => setPaused(true)}
              onEnded={() => setPaused(true)}
              onVolumeChange={fromElement}
              onError={() => setPhase('error')}
            />
          ) : null
        }
      />
      <div className="nx-video-controls">
        {density === 'min' && (
          <span className="nx-video-row">
            {play}
            {timecode}
          </span>
        )}
        {density === 'bar' && (
          // Beside the picture there's height but little width: one control per row.
          <>
            <span className="nx-video-row">
              {play}
              {timecode}
            </span>
            {scrubber}
            <span className="nx-video-row">
              {sound}
              {badge}
            </span>
          </>
        )}
        {density === 'full' && (
          <>
            <span className="nx-video-row">
              {play}
              {scrubber}
              {timecode}
            </span>
            <span className="nx-video-row">
              {sound}
              {badge}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

/** How many meter cells fit in a box, kept current as the widget resizes. */
function useFitChars(ref: { current: HTMLElement | null }, fallback: number) {
  const [chars, setChars] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      // Two characters go to the brackets.
      if (w > 0) setChars(clamp(Math.floor(w / CHAR_PX) - 2, 4, 400))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return chars
}
