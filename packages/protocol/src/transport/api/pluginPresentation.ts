import type { TaskLinkSeed } from './projects.ts'

// What the descriptor routes answer with. Host-defined, unlike everything else a plugin route serves,
// because the host renders these (docs/architecture-overview.md § Who owns which contract).
// Re-exported from @acorn/plugin-api so a plugin's node half types its handlers against the same
// declarations.
//
// The client still validates what arrives: a roster row and a route body are both bytes from a node,
// and a malformed row is dropped rather than thrown into the shell.
export type PluginRailTask = {
  // Optional so established providers can keep their pre-loader task origin. Other plugins use the
  // host-derived `<plugin>:item` value.
  origin?: string
  title?: string
  branch?: string
  // The item's own text: a Linear issue's description, a Rollbar item's facts. The task model has no
  // body column, so nothing is written with it; what reads it is the workflow start from a row menu,
  // which puts the title and this under an `issue` input (docs/workflows.md § Starting a run).
  body?: string
  link?: Pick<TaskLinkSeed, 'connectionId' | 'identifier' | 'ref'>
}
export type PluginRailItem = {
  id: string
  title: string
  /** One pre-joined line of secondary text. For several facts use `fields`, which the host lays out as
   *  columns. linear and rollbar both built a facts array and flattened it with ` · `, and that's what
   *  stopped their lists reading like github's aligned one. */
  subtitle?: string
  /** Ordered secondary facts, one per column. The host reserves the same track width for each, so
   *  the Nth fact lines up down the whole list. Wins over `subtitle` when both are present. */
  fields?: string[]
  /** Draw the aligned fields between the leading icon and title. The default keeps the title first. */
  fieldsFirst?: boolean
  icon?: string
  /** Semantic severity for the icon; the host owns its actual colour. */
  severity?: 'info' | 'warn' | 'danger'
  badge?: string
  /** This row at the width of an icon rail, for a collapsed sidebar: a ticket identifier, an item
   *  number, an HTTP verb. A few characters, under the icon, and nothing else fits.
   *
   *  Its own field rather than the first of `fields`, because the two answer different questions.
   *  `fields` is what lines up in columns down an expanded list, and the fact a source happens to put
   *  first is not always the one that identifies a row: rollbar's is the occurrence count. A source that sends neither this nor `icon` still draws a reachable row, marked with a dot
   *  and named by its tooltip. */
  short?: string
  task?: PluginRailTask
}
export type PluginRailItems = { items: PluginRailItem[] }

// A rail row's `id` survives a round trip the plugin doesn't control: the host hands it back verbatim
// as the pane frame's `context.item`, and the frame recovers the row's full identity from that one
// string. Two halves, because a provider's own identifier isn't globally unique. Two connected Linear
// workspaces can share a team prefix, so the connection travels with it.
//
// Percent-encoded around a single `:` because either half may contain the delimiter. Here rather than
// in each plugin because round-tripping a rail id is the host's contract; linear and rollbar had each
// written the same twenty lines.
export const railItemId = (connectionId: string, identifier: string): string =>
  `${encodeURIComponent(connectionId)}:${encodeURIComponent(identifier)}`

/** The inverse. `null` for anything that is not one of ours: a truncated id, a bad escape, an
 * empty half. A caller branches once instead of validating the parts itself. */
export function parseRailItemId(value: string): [connectionId: string, identifier: string] | null {
  const separator = value.indexOf(':')
  if (separator <= 0 || separator === value.length - 1) return null
  try {
    const connectionId = decodeURIComponent(value.slice(0, separator))
    const identifier = decodeURIComponent(value.slice(separator + 1))
    return connectionId && identifier ? [connectionId, identifier] : null
  } catch {
    return null
  }
}
// `null` hides the badge, so a badge with nothing to say disappears without a second route.
export type PluginSlotBadge = { text: string; tone?: 'neutral' | 'accent' | 'warn'; tooltip?: string } | null
export type PluginAttentionWireItem = {
  id: string
  taskId?: string
  title: string
  detail?: string
  severity: 'info' | 'warn' | 'danger'
  // Epoch millis, for the relative time on the row.
  at: number
}
export type PluginAttentionItems = { items: PluginAttentionWireItem[] }
export type PluginNodeStatValue = { value: number }
