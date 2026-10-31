import { ThemeProvider, useReducedMotion, useTheme, type Theme } from '@/theme'
import { DesktopProvider, useDesktop } from '@/wm/desktopStore'
import { parseCommand } from './agent/parseCommand'
import { DotField } from './DotField'
import { PromptBar } from './PromptBar'
import { WidgetGrid } from './WidgetGrid'

const HELP = 'try "show terminal", "make clock small", "hide notes", "tidy up" or "dark mode".'

/** The whole screen. Providers first, then the layers back to front. */
export function Desktop() {
  return (
    <ThemeProvider>
      <DesktopProvider>
        <DesktopScreen />
      </DesktopProvider>
    </ThemeProvider>
  )
}

function DesktopScreen() {
  const { theme, setTheme } = useTheme()
  const { store } = useDesktop()
  const reduced = useReducedMotion()

  const switchTheme = (next: Theme | 'toggle'): string => {
    const target = next === 'toggle' ? (theme === 'dark' ? 'light' : 'dark') : next
    if (target === theme) return `already in ${theme} mode.`
    setTheme(target)
    return `switched to ${target} mode.`
  }

  const run = (text: string): string => {
    const cmd = parseCommand(text)
    switch (cmd.type) {
      case 'open':
        return store.open(cmd.appId, cmd.size)
      case 'close':
        return store.close(cmd.appId)
      case 'resize':
        return store.resize(cmd.appId, cmd.size)
      case 'tidy':
        return store.tidy()
      case 'closeAll':
        return store.closeAll()
      case 'theme':
        return switchTheme(cmd.theme)
      case 'help':
        return HELP
      case 'unknown':
        return `i can only arrange apps for now. ${HELP}`
    }
  }

  return (
    <div className="nx-desktop" data-reduced={reduced || undefined}>
      <DotField theme={theme} reduced={reduced} />
      <main className="nx-stage">
        <WidgetGrid />
      </main>
      <PromptBar
        onAsk={run}
        themeLabel={theme === 'dark' ? 'light mode' : 'dark mode'}
        onToggleTheme={() => switchTheme('toggle')}
      />
    </div>
  )
}
