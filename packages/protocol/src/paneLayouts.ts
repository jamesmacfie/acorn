// The arrangements a pane can be drawn in, and which regions each one has.
//
// One table, three readers: the manifest parser on the node, the client's re-check of a roster row,
// and the pane registry a compiled plugin registers through. A layout that grew a region on one side
// and not the other is the failure this file exists to make impossible.
//
// A plugin never lays anything out. It names a layout and fills the regions, and the host owns what
// each one means at every width. See docs/panes.md § Layout model for the desktop rendering of
// each layout and for the narrow and terminal projections it has to carry before it lands.

/** Every layout name a pane may declare. Orientation is in the name, never in a prop. */
export const PANE_LAYOUTS = [
  'single',
  'list-detail',
  'header-body-footer',
  'tabs',
  'document-over-frame',
  'frame-beside-document',
  'stack-split',
  'wizard',
] as const

export type PaneLayoutName = (typeof PANE_LAYOUTS)[number]

export const isPaneLayout = (value: unknown): value is PaneLayoutName =>
  typeof value === 'string' && (PANE_LAYOUTS as readonly string[]).includes(value)

/**
 * The regions of one layout.
 *
 * `prefix` is for a layout whose regions are not known until a pane declares them: `tabs` draws one
 * panel per tab, so its regions are `panel:<tab id>` and the count comes from the contribution.
 */
export type LayoutSpec = {
  required: readonly string[]
  optional: readonly string[]
  prefix?: string
}

export const LAYOUT_REGIONS: Record<PaneLayoutName, LayoutSpec> = {
  // The trivial layout. A pane that is one tree still names one, so it inherits the focus group and
  // the padding rules rather than inventing them.
  single: { required: ['body'], optional: [] },
  'list-detail': { required: ['list', 'detail'], optional: ['list-header', 'list-footer'] },
  // All three optional, so `header-body` is this layout with no footer rather than a seventh name.
  'header-body-footer': { required: [], optional: ['header', 'body', 'footer'] },
  // The bar is the host's; the panels are the pane's, one per declared tab.
  tabs: { required: [], optional: [], prefix: 'panel:' },
  'document-over-frame': { required: ['document', 'frame'], optional: [] },
  // The same two regions with the axis flipped, which is why it is a name and not a prop.
  'frame-beside-document': { required: ['document', 'frame'], optional: [] },
  'stack-split': { required: ['top', 'bottom'], optional: [] },
  // The host draws the step indicator and the back and next controls; the step is the plugin's.
  wizard: { required: ['step'], optional: [] },
}

/**
 * What is wrong with this set of region names, or `null` when nothing is.
 *
 * Returns a message rather than throwing, because the three callers report it differently: Zod wants
 * an issue, the pane registry throws at registration, and the client's roster re-check skips one
 * surface and logs it.
 */
export function regionProblem(layout: PaneLayoutName, names: readonly string[]): string | null {
  const spec = LAYOUT_REGIONS[layout]
  const missing = spec.required.filter((name) => !names.includes(name))
  if (missing.length) return `layout '${layout}' needs a ${missing.join(' and a ')} region`
  const known = new Set<string>([...spec.required, ...spec.optional])
  const allowed = (name: string) =>
    known.has(name) || (spec.prefix !== undefined && name.startsWith(spec.prefix) && name.length > spec.prefix.length)
  const unknown = names.filter((name) => !allowed(name))
  if (unknown.length) return `layout '${layout}' has no ${unknown.join(' or ')} region`
  return null
}
