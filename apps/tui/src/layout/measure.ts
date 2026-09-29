import { MeasureMode } from 'yoga-layout'
import type { MeasureFunction } from 'yoga-layout'
import { runText, type Node } from '../tree/node'
import { sliceToWidth, stringWidth } from '../width'
import { measuredField } from '../wrap'

// How wide and how tall a run of text is, which is the one thing Yoga cannot work out for itself.
//
// A `text` node is a leaf to Yoga with a measure function on it. The function concatenates its `#text`
// and `span` children in order, wraps or truncates the result at the width Yoga is offering, and
// answers with the widest line and the number of lines. `wrapMode` decides which, exactly as
// `../kit/cells.tsx` § Line passes it today.
//
// Cached on the node by the width and the text, so a frame that moved nothing measures nothing. Yoga
// only calls a measure function on a node it considers dirty, but the same node is measured more than
// once inside a single pass whenever flex has to try a second width, and paint asks for the same lines
// again afterwards. The cache is what makes those free.
//
// Paint reads the same lines out of the same cache, so the run it draws is the run that was measured.
// If those two ever disagreed, every wrapped paragraph in the app would be a line out.
//
// A field's rows are the same arrangement one question over, and the cache for them is in `../wrap.ts`
// rather than here: `../kit/asking/fieldRef.ts` reads it too, and a static import of this module from there
// would put `yoga-layout` in the eager graph of the build that does not use it
// (../wrap.ts § The cache is here rather than in ./layout/measure.ts).

type Measured = { key: string; lines: readonly string[]; width: number }

const cache = new WeakMap<Node, Measured>()

let misses = 0

/** How many times the cache has had to do the work. Nothing reads this but the layout test, which
 *  cannot otherwise see the difference between a hit and a miss. */
export const measureMisses = (): number => misses

/** The text of this node's run changed, or the prop that decides how it wraps did. */
export const invalidateRun = (node: Node): void => {
  cache.delete(node)
}

/** Greedy word wrap, measured in cells rather than characters.
 *
 *  A word that does not fit on a line of its own is broken by cells rather than dropped, and a single
 *  cluster wider than the whole limit is left over-long for paint to clip: moving it would be worse
 *  than clipping it, and there is nowhere narrower to put it. */
function wrapParagraph(line: string, limit: number): string[] {
  const out: string[] = []
  let current = ''
  let width = 0
  for (const word of line.split(' ')) {
    const wordWidth = stringWidth(word)
    const joined = current === '' ? wordWidth : width + 1 + wordWidth
    if (joined <= limit) {
      current = current === '' ? word : `${current} ${word}`
      width = joined
      continue
    }
    if (current !== '') out.push(current)
    let rest = word
    while (stringWidth(rest) > limit) {
      const head = sliceToWidth(rest, limit)
      if (head.text === '') break
      out.push(head.text)
      rest = rest.slice(head.text.length)
    }
    current = rest
    width = stringWidth(rest)
  }
  if (current !== '' || out.length === 0) out.push(current)
  return out
}

/** The lines a run occupies at a width. `\n` always breaks; `limit` only breaks when wrapping is on. */
export function wrapLines(text: string, limit: number, wrap: boolean): string[] {
  const paragraphs = text.split('\n')
  if (!wrap || limit <= 0 || !Number.isFinite(limit)) return paragraphs
  return paragraphs.flatMap((paragraph) => wrapParagraph(paragraph, limit))
}

/** This node's run at this width, from the cache where the cache still holds. */
export function measuredRun(node: Node, limit: number): Measured {
  const text = runText(node)
  const wrap = node.props.wrapMode === 'word'
  const key = `${limit} ${wrap ? 'w' : 'n'} ${text}`
  const hit = cache.get(node)
  if (hit && hit.key === key) return hit
  misses += 1
  const lines = wrapLines(text, limit, wrap)
  // A loop rather than a `reduce` with a seed. `../keys/tiers.test.ts` greps the whole package for a
  // bare number sitting after a closing bracket, which is how a keymap priority spelled outside the
  // tier table looks, and a seeded reduce reads as one. The grep cannot tell them apart and should
  // not have to.
  let widest = 0
  for (const line of lines) widest = Math.max(widest, stringWidth(line))
  const fresh: Measured = { key, lines, width: widest }
  cache.set(node, fresh)
  return fresh
}

/** The measure function a `textarea` is a leaf to Yoga with: as tall as its wrapped rows are.
 *
 *  OpenTUI's edit buffer answers the same way, and it was measured rather than assumed — a textarea
 *  stacked between two lines of text moves the line below it down one row per line of content, which
 *  is also why a `Textarea` without `grow` is exactly as tall as what is in it. */
export const measureField = (node: Node): MeasureFunction => (width, widthMode) => {
  const offered = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : Infinity
  const limit = widthMode === MeasureMode.Undefined ? Infinity : offered
  const field = measuredField(node, limit)
  return {
    width: widthMode === MeasureMode.Exactly ? offered : Math.min(field.width, limit),
    height: field.rows.length,
  }
}

/** The measure function Yoga calls, bound to the node whose run it measures.
 *
 *  `MeasureMode.Undefined` means Yoga is asking for the natural width and offering nothing, so there
 *  is no limit to wrap at. `AtMost` is an offer, and a run that does not wrap answers with the offer
 *  rather than its natural width, so the box shrinks and paint clips one line instead of the layout
 *  growing past its parent. `Exactly` is not a question. */
export const measureRun = (node: Node): MeasureFunction => (width, widthMode) => {
  const offered = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : Infinity
  const limit = widthMode === MeasureMode.Undefined ? Infinity : offered
  const run = measuredRun(node, limit)
  return {
    width: widthMode === MeasureMode.Exactly ? offered : Math.min(run.width, limit),
    height: run.lines.length,
  }
}
