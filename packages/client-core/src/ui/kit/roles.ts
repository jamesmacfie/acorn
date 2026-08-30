// Role tokens, resolved per host. This is the only file outside a stylesheet that names a CSS
// custom property: a kit node reads a role from here and never spells `--gap-row` itself.
//
// Two columns, from the day the kit exists. `dom` is implemented; `tui` is written down and read by
// nothing, so that a node cannot be added without someone deciding what it does on a host with no
// pixels. See docs/ui-design.md § The closed kit for the table this mirrors.
import type { Border, Radius, RoleName, Size, Space, TextRole, Tone } from './tokens'

/** What a role means to a terminal. `ignored` is an answer; missing is not. */
export type TuiValue = string

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
    none: '0 lines',
    inline: 'one cell',
    row: '0 lines',
    stack: '0 lines',
    section: '1 blank line',
  },
}

// A size role sets height and padding together, so the token named here is the control height it
// keys off. `lg` has no height of its own; it is the roomy padding step.
const size: Mapping<Size> = {
  dom: { xs: '--control-h-xs', sm: '--control-h-sm', md: '--control-h', lg: '--pad-control-lg' },
  tui: {
    xs: 'one line; padding ignored',
    sm: 'one line; padding ignored',
    md: 'one line; padding ignored',
    lg: 'one line; padding ignored',
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
    neutral: 'default',
    muted: 'dim',
    accent: 'the palette accent, per theme',
    ok: 'the palette green, per theme',
    warn: 'the palette yellow, per theme',
    danger: 'the palette red, per theme',
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
    body: 'plain',
    strong: 'bold',
    muted: 'dim',
    mono: 'ignored',
    eyebrow: 'dim uppercase',
    heading: 'bold',
    match: 'reverse',
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
    none: 'nothing',
    divider: '─, or nothing in compact density',
    control: 'underline',
    surface: 'box-drawing corners',
    stripe: '▍ in the tone colour',
  },
}

const radius: Mapping<Radius> = {
  dom: {
    control: '--radius-control',
    surface: '--radius-surface',
    chip: '--radius-chip',
    pill: '--radius-pill',
  },
  tui: { control: 'ignored', surface: 'ignored', chip: 'ignored', pill: 'ignored' },
}

export const ROLE_MAP = { space, size, tone, text, border, radius } as const satisfies
  Record<RoleName, { dom: Record<string, string>; tui: Record<string, TuiValue> }>

/** The DOM value of a role, as something a style attribute can hold. */
export const roleVar = <R extends RoleName>(role: R, value: keyof (typeof ROLE_MAP)[R]['dom']): string =>
  `var(${(ROLE_MAP[role].dom as Record<string, string>)[value as string]})`
