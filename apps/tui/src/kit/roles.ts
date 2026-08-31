import { TextAttributes } from '@opentui/core'
import type { Space, TextRole, Tone } from '@acorn/client-core/kit/tokens/tokens.ts'

// Roles as cells: what a role token means to a terminal, as something a renderable can be handed.
//
// The sentences are already written, one per role value, in the `tui` column of client-core's
// kit/tokens/roles.ts. This file is those sentences turned into numbers, and it lives here in phase 0
// because the sentences are prose and turning them into a third column of `ROLE_MAP` is phase 1's
// `roleCell()`. Nothing else in the TUI may name a colour or a cell count; it asks for a role.
//
// Colour is the terminal's own sixteen slots rather than the theme's forty-odd tokens, which is what
// `roles.ts` says a tone collapses to. Truecolor and per-theme slots are phase 1's; a spike that
// picks its own hexes would be measuring its own palette rather than the kit.

/** Cells of gap a space role spends, on the axis the node stacks along. */
export const spaceCells: Record<Space, number> = {
  none: 0,
  inline: 1,
  row: 0,
  stack: 0,
  section: 1,
}

export const toneColor: Record<Tone, string | undefined> = {
  neutral: undefined,
  muted: undefined,
  accent: 'cyan',
  ok: 'green',
  warn: 'yellow',
  danger: 'red',
}

/** `muted` is dim rather than a colour, which is the one tone that is an attribute. */
export const toneAttributes = (tone: Tone): number => (tone === 'muted' ? TextAttributes.DIM : TextAttributes.NONE)

export const textAttributes: Record<TextRole, number> = {
  body: TextAttributes.NONE,
  strong: TextAttributes.BOLD,
  muted: TextAttributes.DIM,
  // A terminal is monospaced throughout, so asking for mono asks for what is already true.
  mono: TextAttributes.NONE,
  eyebrow: TextAttributes.DIM,
  heading: TextAttributes.BOLD,
  match: TextAttributes.INVERSE,
}

/** Eyebrow is the one text role that changes the characters rather than their attributes. */
export const textTransform = (role: TextRole, value: string): string =>
  role === 'eyebrow' ? value.toUpperCase() : value
