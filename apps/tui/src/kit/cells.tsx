/** @jsxImportSource @opentui/solid */
import { type JSX } from 'solid-js'
import type { TextRole, Tone } from '@acorn/client-core/kit/tokens/tokens.ts'
import { styled, textStyle } from './roles'

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
