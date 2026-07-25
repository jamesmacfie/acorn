import type { ITheme } from '@xterm/xterm'
import { getHighlighter } from '../../github/client/shiki'
import { isAppDark, token } from '../../../core/client/ui/appearance'

// Re-exported for convenience inside this plugin. The generic appearance readers live in
// core/client/ui/appearance.ts so other plugins reach them without a plugin→plugin import.
export { isAppDark, isDarkColor, token, watchAppearance } from '../../../core/client/ui/appearance'

// xterm renders to its own canvas and ignores CSS, so it needs an explicit theme object. Rather
// than hand-maintaining palettes, the theme is derived from the app's two existing sources:
//  - chrome (background/foreground/cursor/selection) reads the CSS tokens (tokens-layout.css) at
//    call time, so the terminal matches whatever theme the chrome is currently showing;
//  - the 16-colour ANSI palette comes from the same VS Code theme JSON Shiki highlights diffs
//    with (github-light/dark ship `terminal.ansi*` colours), so terminal output and diff syntax
//    share one colour source. Adding an app theme = CSS tokens + a Shiki theme; nothing here.

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const

// Map a VS Code theme's `colors` table to xterm's 16 ANSI slots. Pure; exported for tests.
export function ansiPalette(colors: Record<string, string>): Partial<ITheme> {
  const palette: Partial<ITheme> = {}
  for (const name of ANSI) {
    const cap = (name[0].toUpperCase() + name.slice(1)) as Capitalize<typeof name>
    palette[name] = colors[`terminal.ansi${cap}`]
    palette[`bright${cap}`] = colors[`terminal.ansiBright${cap}`]
  }
  return palette
}

// Chrome-only theme, synchronous — used at Terminal construction so there's no flash of xterm's
// default black-on-black while the (async) Shiki theme loads.
export function baseTheme(dark: boolean): ITheme {
  const bg = token('--bg-subtle')
  const fg = token('--text')
  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: dark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.12)',
  }
}

export async function xtermTheme(dark: boolean): Promise<ITheme> {
  const hl = await getHighlighter()
  const { colors } = hl.getTheme(dark ? 'github-dark' : 'github-light')
  return { ...baseTheme(dark), ...ansiPalette(colors ?? {}) }
}

// Match the app's mono font (falls back to monospace before the token is available). Code surfaces
// stay monospace in every style pack, so this reads --font-mono rather than --font-ui.
export const monoFont = (): string => token('--font-mono') || 'monospace'

