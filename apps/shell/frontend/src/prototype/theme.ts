import { useEffect, useLayoutEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'nexus-proto-theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

const systemTheme = (): Theme => (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light')

function savedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

/** Follows the system setting until the user picks a theme, then remembers that choice. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [chosen, setChosen] = useState<Theme | null>(savedTheme)
  const [system, setSystem] = useState<Theme>(systemTheme)

  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const theme = chosen ?? system

  // Before paint, so a dark-mode user never sees a light flash.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const choose = (next: Theme) => {
    setChosen(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* storage unavailable; the choice lasts for this visit only */
    }
  }

  return [theme, choose]
}
