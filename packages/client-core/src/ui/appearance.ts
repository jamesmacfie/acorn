// Reading the appearance axes from JavaScript.
//
// Canvas surfaces — xterm, Monaco, the SQL grid — cannot use CSS, so they resolve tokens at call
// time and re-resolve when the axes change. That is a CORE concern, not a terminal one: it lives
// here so the editor, database and github plugins can use it without importing across plugin
// boundaries (core/boundaries.test.ts treats plugin→plugin coupling as a shrinking baseline).
//
// The token names these read are declared in BRIDGE_TOKENS (./tokenAxes.ts) precisely because a
// rename here fails silently — the lookup is by string.

/** Resolved value of a custom property on `<html>`, trimmed. */
export const token = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Perceived-luminance dark check on a 6-digit hex colour. Pure; exported for tests. */
export const isDarkColor = (hex: string): boolean => {
  const n = parseInt(hex.slice(1), 16)
  // Rec. 601 luma — plenty for "is this background dark?".
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff) < 128
}

/**
 * Is the effective theme dark? Every theme declares this about itself via --is-dark
 * (styles/tokens-theme.css), so there is no hardcoded list of dark theme names to keep in sync.
 *
 * The luma fallback is what this used to do unconditionally, and it constrained the whole token
 * system: it requires --bg to be a literal 6-digit hex, so a theme written with color-mix(),
 * oklch(), rgb() or #fff parsed to NaN and silently classified as light in xterm and Monaco.
 */
export const isAppDark = (): boolean => {
  const flag = token('--is-dark')
  return flag ? flag === '1' : isDarkColor(token('--bg'))
}

/**
 * Call `onChange` whenever the effective appearance could change: a manual data-theme toggle, a
 * data-style change (which moves fonts, sizes and densities), or the OS preference flipping while
 * no manual theme is set. Returns an unsubscribe.
 */
export function watchAppearance(onChange: () => void): () => void {
  const mo = new MutationObserver(onChange)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-style'] })
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', onChange)
  return () => {
    mo.disconnect()
    mq.removeEventListener('change', onChange)
  }
}
