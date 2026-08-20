import type { PanelId } from './model'

// Grid geometry: where a panel sits in a placement, and what happens to its neighbours when it is
// moved or resized. Push-down, the right wall, gravity, and why a plugin has no say over a rect are
// all in docs/dashboards.md § The grid.
//
// Everything here is a pure function over `{ order, rects }`, the same rule shaping.ts and mapping.ts
// follow: vitest in this repo runs in node with no Solid plugin, so anything that lived inside the
// grid component would be unchecked. The components own pointer math and pixels and contain no layout
// arithmetic of their own.

/** Fixed, not responsive. 12 divides into halves, thirds, quarters and sixths, and a fixed count is
 *  what makes a rect meaningful across window sizes and across the clients that share the blob.
 *  Grafana's 24 buys precision nobody asked for at twice the drag fussiness.
 *
 *  A constant rather than config, since there is one placement kind's worth of grid. */
export const COLS = 12

/** All four in cells, all non-negative integers. No pixel is ever persisted: the cell size is derived
 *  from the container at render time. */
export type Rect = { x: number; y: number; w: number; h: number }

/** One placement's geometry. `order` is canonical for reading order, and is what a client with no
 *  rects renders by; `rects` is what this module arranges. An id in `order` with no rect is the normal
 *  case, not an error. It is the migration, the recovery from a write by a client without rects, and
 *  the new-panel default, all at once. */
export type PanelLayout = {
  order: readonly PanelId[]
  rects: Readonly<Record<PanelId, Rect>>
}

/** How small a panel of a given view kind may be, and how big it arrives. The view already gates what
 *  the editor offers; it also knows how small a panel can be before it is furniture. A tuning table,
 *  not a contract. See docs/dashboards.md § The grid. */
export type PanelSize = { minW: number; minH: number; w: number; h: number }

const SIZES: Record<string, PanelSize> = {
  // One number and a label. Down to a single cell: a stat stays readable as a tile, and the sparkline
  // is written to be squeezed out rather than push the number off.
  stat: { minW: 1, minH: 1, w: 3, h: 2 },
  // Rows need a title's width.
  list: { minW: 3, minH: 2, w: 4, h: 4 },
  // Columns need more.
  table: { minW: 4, minH: 2, w: 6, h: 4 },
  // Columns side by side; default full-width.
  board: { minW: 4, minH: 3, w: 12, h: 4 },
  // An axis needs room to carry ticks at both ends.
  chart: { minW: 4, minH: 3, w: 6, h: 4 },
}

/** A view kind this client cannot draw still gets a rect. It renders the inert "view unavailable"
 *  card, which is a panel like any other and must not be zero-sized. */
export const sizeFor = (kind: string): PanelSize => SIZES[kind] ?? SIZES.list

/** The wizard's S, M and L footprints for a view kind: three widths over the per-kind defaults above,
 *  at that kind's own height.
 *
 *  A starting rect, not stored config. What the wizard commits goes through `firstFit` and
 *  `setLayoutAt` like every other rect and is thereafter just geometry, so the table can be retuned
 *  without a migration.
 *
 *  `M` is the kind's default, `L` is the full grid and `S` is its minimum. A kind whose default is
 *  already full width, such as a board, collapses two of them to the same rect. There is no fourth
 *  size hiding in a 12-column grid. */
export const sizePresets = (kind: string): { s: Rect; m: Rect; l: Rect } => {
  const size = sizeFor(kind)
  const at = (w: number): Rect => ({ x: 0, y: 0, w: Math.max(size.minW, Math.min(COLS, w)), h: size.h })
  return { s: at(size.minW), m: at(size.w), l: at(COLS) }
}

// ── Rects ─────────────────────────────────────────────────────────────────────────────────────

export const collides = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Integers, inside the columns, at or above the minimums. Width is settled before x, because a rect
 *  too wide for the grid has to lose width rather than be pushed off the left edge. */
export function clampRect(rect: Rect, size: PanelSize): Rect {
  const w = Math.max(size.minW, Math.min(COLS, Math.floor(rect.w)))
  const h = Math.max(size.minH, Math.floor(rect.h))
  return {
    w,
    h,
    x: Math.max(0, Math.min(COLS - w, Math.floor(rect.x))),
    y: Math.max(0, Math.floor(rect.y)),
  }
}

type Placed = { id: PanelId; rect: Rect }

/** Reading order, `(y, x)` with the id as the tiebreak so every client paired with the node agrees.
 *
 *  This is the order everything else here iterates in, and it is what `placements` is rewritten to on
 *  every commit. See docs/dashboards.md § The grid for the three things that keeps true. */
export function readingOrder(layout: PanelLayout): PanelId[] {
  return layout.order
    .filter((id) => layout.rects[id])
    .sort((left, right) => {
      const a = layout.rects[left]
      const b = layout.rects[right]
      return a.y - b.y || a.x - b.x || left.localeCompare(right)
    })
}

/** Slide a rect along one axis until it clears everything already placed.
 *
 *  `pushRight` and `pushDown` are this one function with an axis and a bound. On `y` the page scrolls,
 *  so there is no wall and the slide always succeeds. On `x` the grid has a right edge, and running
 *  into it answers `undefined`, which is how the resize clamp finds the widest width that fits.
 *
 *  Termination: each step strictly increases the coordinate past a rect that was already placed, and
 *  there are finitely many of those, so the loop is bounded by `placed.length`. The guard covers a
 *  rect the clamp did not see. */
function slide(rect: Rect, placed: readonly Placed[], axis: 'x' | 'y'): Rect | undefined {
  let out = rect
  for (let guard = 0; guard <= placed.length; guard++) {
    const hit = placed.find((entry) => collides(out, entry.rect))
    if (!hit) return out
    out = axis === 'x'
      ? { ...out, x: hit.rect.x + hit.rect.w }
      : { ...out, y: hit.rect.y + hit.rect.h }
    if (axis === 'x' && out.x + out.w > COLS) return undefined
  }
  return undefined
}

const toLayout = (order: readonly PanelId[], placed: readonly Placed[]): PanelLayout => ({
  order,
  rects: Object.fromEntries(placed.map((entry) => [entry.id, entry.rect])),
})

// ── Gravity ───────────────────────────────────────────────────────────────────────────────────

/** Every panel floats up as far as it can without collision, processed in reading order so the result
 *  is stable and order-preserving. Panels keep their `x`; compaction is vertical only, which is why a
 *  horizontal push is not undone by it. */
export function compact(layout: PanelLayout): PanelLayout {
  const placed: Placed[] = []
  for (const id of readingOrder(layout)) {
    const rect = layout.rects[id]
    let y = rect.y
    while (y > 0 && !placed.some((entry) => collides({ ...rect, y: y - 1 }, entry.rect))) y--
    placed.push({ id, rect: { ...rect, y } })
  }
  return toLayout(layout.order, placed)
}

// ── Placement ─────────────────────────────────────────────────────────────────────────────────

/** The first position, scanning top-to-bottom then left-to-right, where `size` fits without collision.
 *  Worst case, after the bottom of everything.
 *
 *  Deterministic by requirement, not as a nicety: this places a panel that has no rect, and every
 *  client paired with the node has to auto-place it identically or the same composition reads
 *  differently on two machines. */
export function firstFit(rects: readonly Rect[], size: { w: number; h: number }): Rect {
  const w = Math.max(1, Math.min(COLS, Math.floor(size.w)))
  const h = Math.max(1, Math.floor(size.h))
  const bottom = rects.reduce((lowest, rect) => Math.max(lowest, rect.y + rect.h), 0)
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + w <= COLS; x++) {
      const candidate = { x, y, w, h }
      if (!rects.some((rect) => collides(candidate, rect))) return candidate
    }
  }
  return { x: 0, y: bottom, w, h }
}

/** The self-repair pass: run after parse and before every render, and its fixed point is the only
 *  layout the renderer ever draws. No sequence of partial writes, writes by a client without rects or
 *  hand-edited blobs can put two panels on top of each other, because nothing else reaches the
 *  renderer.
 *
 *  Two passes, in this order, for determinism. Panels that have a rect are placed first, in reading
 *  order, so a rect the user set keeps its meaning. Panels with none are then first-fitted in `order`
 *  sequence into whatever is left. Interleaving the two would make auto-placement depend on the object
 *  key order of the persisted blob. */
export function normalize(layout: PanelLayout, sizeOf: (id: PanelId) => PanelSize): PanelLayout {
  const placed: Placed[] = []

  for (const id of readingOrder(layout)) {
    const rect = clampRect(layout.rects[id], sizeOf(id))
    // Down, always: an overlap left by a partial write is resolved the same way a drag resolves one.
    placed.push({ id, rect: slide(rect, placed, 'y') ?? rect })
  }

  for (const id of layout.order) {
    if (layout.rects[id] || placed.some((entry) => entry.id === id)) continue
    const size = sizeOf(id)
    placed.push({ id, rect: firstFit(placed.map((entry) => entry.rect), size) })
  }

  return compact(toLayout(layout.order, placed))
}

// ── The gesture ───────────────────────────────────────────────────────────────────────────────

/** Place a candidate rect, resolve the pushes it causes, compact. Drag and resize are the same shape;
 *  only the axis differs.
 *
 *  This is the preview. Pointer math turns pixels into a candidate rect and the placeholder renders
 *  this function's output live, so release persists exactly what was on screen.
 *
 *  `undefined` means the push chain hit the right wall, which only `x` can do. */
export function apply(
  layout: PanelLayout,
  id: PanelId,
  candidate: Rect,
  axis: 'x' | 'y',
  sizeOf: (id: PanelId) => PanelSize,
): PanelLayout | undefined {
  // The moved panel goes down first and never moves again: it is the anchor, and everything else
  // arranges around it. That is what makes the gesture feel direct.
  const placed: Placed[] = [{ id, rect: clampRect(candidate, sizeOf(id)) }]
  for (const other of readingOrder(layout)) {
    if (other === id) continue
    const settled = slide(layout.rects[other], placed, axis)
    if (!settled) return undefined
    placed.push({ id: other, rect: settled })
  }
  return compact(toLayout(layout.order, placed))
}

/** A drag. Pushes down, so it can never fail: the page has no bottom wall. */
export const applyMove = (
  layout: PanelLayout,
  id: PanelId,
  candidate: Rect,
  sizeOf: (id: PanelId) => PanelSize,
): PanelLayout => apply(layout, id, candidate, 'y', sizeOf) ?? layout

/** A resize, with the wall clamp.
 *
 *  The axis follows what the handle did. A panel that got wider pushes its neighbours right and can
 *  run out of room, so it walks the width down until the chain fits and the handle stops moving.
 *  Taller, narrower or shorter pushes down, which always succeeds. */
export function applyResize(
  layout: PanelLayout,
  id: PanelId,
  candidate: Rect,
  sizeOf: (id: PanelId) => PanelSize,
): PanelLayout {
  const size = sizeOf(id)
  const widened = candidate.w > (layout.rects[id]?.w ?? size.w)
  if (!widened) return apply(layout, id, candidate, 'y', sizeOf) ?? layout
  for (let w = Math.min(COLS, Math.floor(candidate.w)); w >= size.minW; w--) {
    const out = apply(layout, id, { ...candidate, w }, 'x', sizeOf)
    if (out) return out
  }
  return layout
}
