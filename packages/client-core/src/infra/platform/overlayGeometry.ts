import type { VisibleElementRect } from './webviewGeometry'

export const overlaps = (a: VisibleElementRect, b: VisibleElementRect): boolean =>
  a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0
  && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** Even-odd paths remove page pixels from a DOM branch while its body-level portals stay live. */
export function pageClip(bounds: VisibleElementRect, pages: readonly VisibleElementRect[]): string {
  const rectangle = (r: VisibleElementRect) =>
    `M${r.x},${r.y}h${r.width}v${r.height}h${-r.width}Z`
  const outer = rectangle({ x: 0, y: 0, width: bounds.width, height: bounds.height })
  // Even-odd overlapping holes cancel each other. Partition their union into disjoint slabs.
  const edges = [...new Set(pages.flatMap((r) => [r.x, r.x + r.width]))].sort((a, b) => a - b)
  const union: VisibleElementRect[] = []
  for (let i = 1; i < edges.length; i++) {
    const left = edges[i - 1], right = edges[i]
    const intervals = pages.filter((r) => r.x < right && r.x + r.width > left && r.height > 0)
      .map((r) => [r.y, r.y + r.height]).sort((a, b) => a[0] - b[0])
    const merged: number[][] = []
    for (const interval of intervals) {
      const previous = merged.at(-1)
      if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1])
      else merged.push([...interval])
    }
    for (const [top, bottom] of merged) union.push({ x: left, y: top, width: right - left, height: bottom - top })
  }
  const holes = union.map((r) => rectangle({ ...r, x: r.x - bounds.x, y: r.y - bounds.y })).join('')
  return `path(evenodd, "${outer}${holes}")`
}
