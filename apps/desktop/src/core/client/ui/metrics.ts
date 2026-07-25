// Read density tokens from JS.
//
// Virtualized lists cannot get their row height from CSS. @tanstack/solid-virtual needs the height
// as a number to compute the scroll range, and it writes the result back as an INLINE style — which
// beats any stylesheet rule. So `.pr-row { height: var(--row-h) }` is dead weight: PullList hardcoded
// 36 and applied `height: ${vi.size}px` inline, meaning a style pack could change --row-h and the
// PR list would not move at all.
//
// These read the token instead, so density is real in the two densest surfaces in the app rather
// than a font swap that lies about itself.

/** Resolve a length token to a number of pixels, falling back if it is unset or non-numeric. */
export const cssPx = (name: string, fallback: number): number => {
  if (typeof document === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name)
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Row height for virtualized lists. Deliberately a separate token from --row-h so pure-CSS density
 * and virtualizer-coupled density can be tuned independently — a pack can make padded rows roomier
 * without forcing a re-measure of every virtual list.
 */
export const rowHeight = (): number => cssPx('--row-h-virt', 36)

/** Compact row height — the SQL result grid. */
export const rowHeightSm = (): number => cssPx('--row-h-sm', 30)

/** Terminal font size. xterm renders to a canvas and cannot read CSS. */
export const termFontSize = (): number => cssPx('--term-fs', 13)
