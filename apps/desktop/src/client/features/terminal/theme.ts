import type { ITheme } from '@xterm/xterm'

// xterm renders to its own canvas and ignores CSS, so it needs an explicit theme object. We mirror
// the app's light/dark tokens (tokens-layout.css) so the terminal matches the rest of the UI, and
// give each mode a full ANSI palette tuned for its background — a dark-tuned palette on a light
// background is unreadable, so we ship both. ANSI colours reuse the app's diff markers where they
// line up (add/del/warn) for consistency.

const DARK: ITheme = {
  background: '#1a1a1a', // --bg-subtle (dark)
  foreground: '#dddddd', // --text (dark)
  cursor: '#dddddd',
  cursorAccent: '#1a1a1a',
  selectionBackground: 'rgba(255, 255, 255, 0.18)',
  black: '#2a2a2a',
  red: '#f85149',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#6aa3ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#dddddd',
  brightBlack: '#5d5d5d',
  brightRed: '#ff7b72',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#ffffff',
}

const LIGHT: ITheme = {
  background: '#fafafa', // --bg-subtle (light)
  foreground: '#242424', // --text (light)
  cursor: '#242424',
  cursorAccent: '#fafafa',
  selectionBackground: 'rgba(0, 0, 0, 0.12)',
  black: '#242424',
  red: '#cf222e',
  green: '#1a7f37',
  yellow: '#9a6700',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#7d4e00',
  brightBlue: '#0550ae',
  brightMagenta: '#6639ba',
  brightCyan: '#3192aa',
  brightWhite: '#242424',
}

// Effective theme: an explicit data-theme on <html> wins (the app's manual toggle), else fall back
// to the OS preference — exactly the precedence tokens-layout.css uses.
export function isAppDark(): boolean {
  const set = document.documentElement.dataset.theme
  if (set === 'dark') return true
  if (set === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const xtermTheme = (dark: boolean): ITheme => (dark ? DARK : LIGHT)

// Match the app's mono font (falls back to monospace before the token is available).
export const monoFont = (): string => getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace'

// Call `onChange` whenever the effective theme could change: a manual data-theme toggle, or the OS
// preference flipping while no manual theme is set. Returns an unsubscribe.
export function watchTheme(onChange: () => void): () => void {
  const mo = new MutationObserver(onChange)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', onChange)
  return () => {
    mo.disconnect()
    mq.removeEventListener('change', onChange)
  }
}
