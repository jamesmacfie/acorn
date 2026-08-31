/** @jsxImportSource @opentui/solid */
import { Show, type JSX } from 'solid-js'
import type { TextRole, Tone } from '@acorn/client-core/kit/tokens/tokens.ts'
import { borderCell, styled, textStyle } from './roles'

// The three things every component in this package needs, and the reason each exists.
//
// A cell host is stricter than the DOM in one structural way: a run of text must have a `text`
// parent. On the DOM a bare string anywhere is a text node nobody thinks about, so the kit's
// element-typed props — `leading`, `trailing`, `meta`, `actions`, `icon` — are handed bare strings by
// panes writing perfectly correct kit. That difference belongs to the host, not to the caller.

/** A prop that takes "some UI" and is often handed a bare string. Wraps one, drops an empty one, and
 *  passes a real tree through. */
export const slot = (value: JSX.Element): JSX.Element => {
  if (value === null || value === undefined || value === false || value === true) return null
  if (typeof value === 'string' || typeof value === 'number') {
    return value === '' ? null : <text>{String(value)}</text>
  }
  return value
}

/** Children as one string, for a node that draws a line rather than a box. A terminal has no inline
 *  flow: `text` takes content, so a run of words has to arrive as words. */
export const flatten = (value: unknown): string => {
  if (value === null || value === undefined || value === false || value === true) return ''
  if (Array.isArray(value)) return value.map(flatten).join('')
  if (typeof value === 'function') return flatten((value as () => unknown)())
  return String(value)
}

/** One run of text at a role and a tone. The workhorse: no component in this package builds a `text`
 *  by hand, so no component can name a colour or an attribute of its own. */
export function Line(props: { role?: TextRole; tone?: Tone; wrap?: boolean; children: JSX.Element }) {
  const run = () => styled(flatten(props.children), props.role, props.tone)
  return (
    <text {...run().style} wrapMode={props.wrap ? 'word' : 'none'}>{run().text}</text>
  )
}

/** A divider between two regions, along the axis it separates: a line across for `x`, a column of
 *  cells for `y`.
 *
 *  One side of a box's border rather than a run of repeated characters, so the renderer draws it to
 *  whatever width or height the layout gave it and nothing here measures anything. Drawn only where
 *  the `divider` border role has a glyph at all: a style pack may set it to nothing, and then this
 *  draws nothing and the layout is still correct, which is the role's own promise. */
export function Rule(props: { axis?: 'x' | 'y' }) {
  const vertical = () => props.axis === 'y'
  return (
    <Show when={borderCell('divider').glyph}>
      <box border={vertical() ? ['left'] : ['top']} borderStyle="single" flexShrink={0} />
    </Show>
  )
}

/** The style of a run, for the few places that hand `text` its own content. */
export const runStyle = (role?: TextRole, tone?: Tone) => {
  const { transform: _transform, ...style } = textStyle(role, tone)
  return style
}

/** Cut to a width, with a `…` where something was cut. Every truncating node — `Table`, `Grid`, a
 *  `Row`'s meta — cuts the same way, so a reader learns the mark once. */
export const ellipsise = (value: string, width: number): string =>
  width <= 0 ? '' : value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`

/** Pad to a width, for a column that has to line up with the one above it. */
export const pad = (value: string, width: number): string => ellipsise(value, width).padEnd(width, ' ')
