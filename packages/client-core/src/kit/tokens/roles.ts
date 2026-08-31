// Role tokens, resolved per host. This is the only file outside a stylesheet that names a CSS
// custom property: a kit node reads a role from here and never spells `--gap-row` itself.
//
// Two columns, from the day the kit exists. `dom` resolves to a custom property; `tui` says what the
// role means to a terminal and, since the terminal host started drawing the kit, carries the same
// answer as something a cell renderer can act on. See docs/ui-design.md § The closed kit for the
// table this mirrors.
import type { Border, Radius, RoleName, Size, Space, TextRole, Tone } from './tokens'

/** The colours a role may ask for, named by what they mean rather than by an ANSI index. The host
 *  turns one into a colour: the terminal's own slot, or the theme's hex where the terminal says it
 *  can take one (apps/tui/src/appearance.ts). */
export type Slot = 'default' | 'accent' | 'ok' | 'warn' | 'danger'

/** What a run of cells can be, beyond its colour. */
export type CellAttribute = 'bold' | 'dim' | 'inverse' | 'underline'

/** A role as cells: what the host draws for it, and nothing about how. Empty is an answer, and it is
 *  the answer for every role value whose sentence is `ignored`. */
export type CellStyle = {
  slot?: Slot
  attrs?: readonly CellAttribute[]
  /** The character this role spends: a rule, a stripe. */
  glyph?: string
  /** A box around what the role wraps, drawn in the host's own box characters. */
  box?: true
  /** Cells of gap along the row. */
  cells?: number
  /** Lines of gap down the column. */
  lines?: number
  /** The role changes the characters themselves, not their attributes. */
  upper?: true
}

/** What a role means to a terminal: the sentence, which is the documentation, and the cells, which
 *  are what `roleCell()` hands a component. `ignored` is an answer; missing is not. */
export type TuiValue = CellStyle & { said: string }

type Mapping<Value extends string> = { dom: Record<Value, string>; tui: Record<Value, TuiValue> }

const space: Mapping<Space> = {
  dom: {
    none: '--space-0',
    inline: '--gap-inline',
    row: '--gap-row',
    stack: '--gap-stack',
    section: '--gap-section',
  },
  tui: {
    none: { said: '0 lines', lines: 0 },
    inline: { said: 'one cell', cells: 1 },
    row: { said: '0 lines', lines: 0 },
    stack: { said: '0 lines', lines: 0 },
    section: { said: '1 blank line', lines: 1 },
  },
}

// A size role sets height and padding together, so the token named here is the control height it
// keys off. `lg` has no height of its own; it is the roomy padding step.
const size: Mapping<Size> = {
  dom: { xs: '--control-h-xs', sm: '--control-h-sm', md: '--control-h', lg: '--pad-control-lg' },
  tui: {
    xs: { said: 'one line; padding ignored', lines: 1 },
    sm: { said: 'one line; padding ignored', lines: 1 },
    md: { said: 'one line; padding ignored', lines: 1 },
    lg: { said: 'one line; padding ignored', lines: 1 },
  },
}

const tone: Mapping<Tone> = {
  dom: {
    neutral: '--text',
    muted: '--text-muted',
    accent: '--accent',
    ok: '--state-ok',
    warn: '--state-warn',
    danger: '--state-bad',
  },
  tui: {
    neutral: { said: 'default', slot: 'default' },
    // The one tone that is an attribute rather than a colour, so it reads as quiet on a terminal
    // whose palette we did not choose.
    muted: { said: 'dim', attrs: ['dim'] },
    accent: { said: 'the palette accent, per theme', slot: 'accent' },
    ok: { said: 'the palette green, per theme', slot: 'ok' },
    warn: { said: 'the palette yellow, per theme', slot: 'warn' },
    danger: { said: 'the palette red, per theme', slot: 'danger' },
  },
}

const text: Mapping<TextRole> = {
  dom: {
    body: '--fs',
    strong: '--fw-semibold',
    muted: '--text-muted',
    mono: '--font-mono',
    eyebrow: '--label-size',
    heading: '--heading-weight',
    match: '--find-hit-bg',
  },
  tui: {
    body: { said: 'plain' },
    strong: { said: 'bold', attrs: ['bold'] },
    muted: { said: 'dim', attrs: ['dim'] },
    // A terminal is monospaced throughout, so asking for mono asks for what is already true.
    mono: { said: 'ignored' },
    eyebrow: { said: 'dim uppercase', attrs: ['dim'], upper: true },
    heading: { said: 'bold', attrs: ['bold'] },
    match: { said: 'reverse', attrs: ['inverse'] },
  },
}

const border: Mapping<Border> = {
  dom: {
    none: '--bw-0',
    divider: '--divider',
    control: '--control-border',
    surface: '--surface-border',
    stripe: '--stripe-w',
  },
  tui: {
    none: { said: 'nothing' },
    divider: { said: '─, or nothing in compact density', glyph: '─' },
    control: { said: 'underline', attrs: ['underline'] },
    surface: { said: 'box-drawing corners', box: true },
    stripe: { said: '▍ in the tone colour', glyph: '▍' },
  },
}

const radius: Mapping<Radius> = {
  dom: {
    control: '--radius-control',
    surface: '--radius-surface',
    chip: '--radius-chip',
    pill: '--radius-pill',
  },
  tui: {
    control: { said: 'ignored' },
    surface: { said: 'ignored' },
    chip: { said: 'ignored' },
    pill: { said: 'ignored' },
  },
}

export const ROLE_MAP = { space, size, tone, text, border, radius } as const satisfies
  Record<RoleName, { dom: Record<string, string>; tui: Record<string, TuiValue> }>

/** The DOM value of a role, as something a style attribute can hold. */
export const roleVar = <R extends RoleName>(role: R, value: keyof (typeof ROLE_MAP)[R]['dom']): string =>
  `var(${(ROLE_MAP[role].dom as Record<string, string>)[value as string]})`

/** The terminal value of a role, as something a cell renderer can hand a renderable. `roleVar`'s
 *  sibling, and the only way a TUI component learns what a role costs: no component names a colour,
 *  a gap, or a box character of its own.
 *
 *  Empty for a role value whose sentence is `ignored`, which is every radius and `text.mono`. That is
 *  the answer, not a gap in the table — `said` is still there to be read. */
export const roleCell = <R extends RoleName>(role: R, value: keyof (typeof ROLE_MAP)[R]['tui']): CellStyle => {
  const { said: _said, ...cell } = (ROLE_MAP[role].tui as Record<string, TuiValue>)[value as string]
  return cell
}
