// The role tokens: the only values a kit node's props accept. See docs/ui-design.md § The closed
// kit for why a plugin names a meaning and never a pixel, a colour, or a class.
//
// Each host owns the mapping from a role to its own value; `kit/roles.ts` holds the DOM one and the
// terminal one side by side. Adding a role means deciding both, which is the point: a role with no
// answer on a host with no pixels is a value pretending to be a meaning.

/** Distance between things. `none` and four steps, from "inside one control" to "between sections". */
export const space = ['none', 'inline', 'row', 'stack', 'section'] as const

/** Four steps, and only four. A fifth is a new component, not a new size. */
export const size = ['xs', 'sm', 'md', 'lg'] as const

/** What a thing means, not what colour it is. */
export const tone = ['neutral', 'muted', 'accent', 'ok', 'warn', 'danger'] as const

/** How text carries. `mono` is the only one a host without fonts ignores outright. */
export const text = ['body', 'strong', 'muted', 'mono', 'eyebrow', 'heading'] as const

/** Which border this is, by the job it does. See docs/ui-design.md § Borders: a pack may set any of
 *  these to zero width, so picking the wrong role renders nothing at all. */
export const border = ['none', 'divider', 'control', 'surface', 'stripe'] as const

/** Which corner rounding, by the surface it rounds. */
export const radius = ['control', 'surface', 'chip', 'pill'] as const

export type Space = (typeof space)[number]
export type Size = (typeof size)[number]
export type Tone = (typeof tone)[number]
export type TextRole = (typeof text)[number]
export type Border = (typeof border)[number]
export type Radius = (typeof radius)[number]

/** Every enum, keyed by its name, so a test can walk them without naming each one. */
export const ROLE_ENUMS = { space, size, tone, text, border, radius } as const
export type RoleName = keyof typeof ROLE_ENUMS
