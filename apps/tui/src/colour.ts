// What a colour is on this host, and there are only three answers.
//
// A terminal can be asked for the colour the person already chose, for one of the sixteen slots their
// theme fills in, or — where it says it can take one — for a 24-bit triple. So the type is those three
// and nothing else. No alpha, because there is nothing to blend with; no CSS name, because a name
// turns the accent into a fixed `#00FFFF` on every terminal (`./appearance.ts`).
//
// `default` is the one that matters. An unset foreground painted as opaque white is white on white on
// a light terminal, for every markdown paragraph and every line of every diff. Paint writes `39` and
// `49` for `default`, so the class is fixed where the colour is emitted rather than by every role
// remembering to name one.
//
// This file knows nothing about paint and nothing about the tree. `./paint/` turns a `Color` into SGR
// parameters, `./tree/jsx.ts` types the props that carry one, and `./appearance.ts` produces them.

/** The terminal's own colour, one of its sixteen slots, or a 24-bit triple.
 *
 *  An index is 0 to 15: the eight ANSI colours and their bright halves, which is the range a terminal
 *  actually has slots for. `./paint/flush.ts` clamps rather than trusting, because the numbers arrive
 *  from a theme. */
export type Color = 'default' | number | readonly [number, number, number]

const rgb = (value: readonly unknown[]): Color | null => {
  if (value.length !== 3) return null
  const triple = value.map((part) => (typeof part === 'number' && Number.isFinite(part) ? Math.round(part) : -1))
  return triple.some((part) => part < 0) ? null : (triple as [number, number, number])
}

/** Whatever a prop holds, as a colour.
 *
 *  Tolerant on purpose: props are untyped by the time paint reads them, so anything unrecognised is
 *  `default`, the terminal's own colour, which is the safe answer and never white on white. */
export function toColor(value: unknown): Color {
  if (value === 'default') return 'default'
  if (typeof value === 'number') return Number.isInteger(value) ? value : 'default'
  if (Array.isArray(value)) return rgb(value) ?? 'default'
  return 'default'
}

/** The same, for a prop that may be absent: absent inherits, present names a colour. A `span` with no
 *  colour of its own takes its parent `text`'s, which is what a run of styled words inside a sentence
 *  is. */
export const colorOr = (value: unknown, inherited: Color): Color =>
  value === undefined || value === null ? inherited : toColor(value)

/** Two colours, compared. Needed because an RGB triple is an array, so the diff cannot use `===`. */
export function sameColor(one: Color, two: Color): boolean {
  if (one === two) return true
  if (typeof one !== 'object' || typeof two !== 'object') return false
  return one[0] === two[0] && one[1] === two[1] && one[2] === two[2]
}
