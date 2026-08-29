// The cooperative cross-plugin seam: plugin A opens a point, plugin B fills it, and the host is the
// only thing that carries anything between them (docs/plugins.md § Cooperative extension points).
//
// No JSX import here (docs/frontend.md § Registries and plugins). The host that draws these
// deliveries is `plugins/chrome/ExtensionPointHost.tsx`.
import {
  parseExtensionPointRef,
  takesPluginExtensions,
  type ArbitrationMode,
  type ExtensionPointKind,
  type ExtensionPointLocation,
  type PluginAnnotationKey,
  type PluginAnnotationMark,
  type PluginExtensionItem,
} from '@acorn/protocol/extensionPoints.ts'
import { hasHostCapability, type HostCapabilityRequirement } from '../hostCapabilities'
import { Registry } from './registry'

export type { ArbitrationMode, ExtensionPointKind, ExtensionPointLocation }

/** A point plugin A hosts. `id` is the qualified `<ownerId>:<pointId>` the host minted
 *  (docs/plugins.md § Cooperative extension points); nothing else in the app addresses a point by any
 *  other name. */
export type ExtensionPointContribution = {
  id: string
  /** The plugin that opened the point, stamped by the host (docs/plugins.md § Cooperative extension
   *  points). */
  ownerId: string
  label: string
  /** Which of the five things this point takes (@acorn/protocol/extensionPoints.ts). Re-checked off the
   *  roster row before registration, so a newer node's kind is refused rather than coerced. */
  kind: ExtensionPointKind
  /** `rows` and `rectangle` only: where on the owner's surface, and which surface. */
  location?: ExtensionPointLocation
  surface?: string
  /** `annotation` only: the fields the owner keys its items by, in the order the lookup string is
   *  minted from. */
  key?: readonly string[]
  /** `remote` and `rectangle`: how the host picks between contributors. */
  mode?: ArbitrationMode
  /** `stack` only: how many contributors fit before the host draws a disclosure. */
  max: number
  /** The platform question, the same field every host-filtered contribution takes
   *  (../hostCapabilities.ts). */
  requires?: HostCapabilityRequirement
  /** Is the owning plugin running on the node being looked at? A point whose owner is not there has no
   *  surface on screen, so it has nothing to deliver into. */
  when?: () => boolean
}

/**
 * One plugin's contribution to one point. `fetch` and `run` are closures the chrome pass built over a
 * route and a verb, so nothing a plugin wrote reaches this registry as code.
 *
 * `carrier` says what it brings, and it is the contributor's own declaration rather than the owner's:
 * the two manifests are read independently and in an order nobody controls, so the match between a
 * carrier and a point's kind happens at delivery (`extensionDeliveries` and its siblings below).
 */
export type ExtensionContribution = {
  id: string
  /** The contributing plugin, stamped host-side and rendered beside what it brought
   *  (docs/plugins.md § Cooperative extension points, "what the host binds"). */
  pluginId: string
  /** The qualified point this fills. */
  point: string
  label: string
  order: number
  carrier: 'items' | 'remote' | 'frame' | 'route'
  /** `remote` and `frame`: which key values this draws. Absent means every key, which is the ordinary
   *  answer in a `stack` slot. */
  matches?: readonly string[]
  /** `remote`: the key of the object this plugin's bundle passed to `mountTree`. */
  entry?: string
  /** `remote`: the bundle this device accepted. The worker runs these bytes and no others. */
  hash?: string
  /** `frame`: the id of the `inline` surface this places. */
  frame?: string
  /** As on the point above (../hostCapabilities.ts). */
  requires?: HostCapabilityRequirement
  when?: () => boolean
  /** `items` only. */
  fetch?: (signal: AbortSignal) => Promise<PluginExtensionItem[]>
  /** `items` on an annotation point only: the batched marks call. */
  marks?: (keys: PluginAnnotationKey[], signal: AbortSignal) => Promise<PluginAnnotationMark[]>
  /** Absent when the contribution declared no verb, a read-only list, which is a real answer. */
  run?: (item: PluginExtensionItem) => void
}

export const extensionPointRegistry = new Registry<ExtensionPointContribution>('extension-point')
export const extensionRegistry = new Registry<ExtensionContribution>('extension')

/** The point drawn at this location of this plugin's surface, or `undefined`. Keyed on all three
 *  because `surface` ids are un-namespaced across plugins. */
export const extensionPointFor = (
  ownerId: string,
  surface: string,
  location: ExtensionPointLocation,
): ExtensionPointContribution | undefined =>
  extensionPointRegistry.entries().find((point) =>
    point.ownerId === ownerId && point.surface === surface && point.location === location)

/**
 * Everything eligible for one point right now, in declared order, whatever the point's kind.
 *
 * The eligibility rules are the same for all five, which is why this is one function: the point has to
 * exist, both plugins have to be running on the node being looked at, both have to be drawable on this
 * host, and the contributor's carrier has to be one the point's kind takes. A contribution that fails
 * any of them is silent rather than an error (docs/plugins.md § Cooperative extension points, "an
 * unmatched contribution is silent"), which is right for a user and wrong for an author, and is why
 * `unmatchedExtensions` below exists.
 *
 * Ties break on id, so two contributions at the same order are stable rather than dependent on plugin
 * registration sequence. Same rule as the slot hosts and the context menu.
 */
export function extensionDeliveries(pointId: string): ExtensionContribution[] {
  const point = extensionPointRegistry.get(pointId)
  if (!point || !hasHostCapability(point.requires) || !(point.when?.() ?? true)) return []
  // `pane.aside` is the one location filled by the user rather than by a plugin's `extensions`
  // (dashboards/region.ts). Nothing renders an aside through this function, but "who may fill this
  // location" is a property of the location, and this is where a test can reach it.
  if (point.kind === 'rows' && !takesPluginExtensions(point.location ?? 'pane.footer')) return []
  return extensionRegistry.entries()
    .filter((entry) =>
      entry.point === pointId
      && carrierFits(point.kind, entry.carrier)
      && hasHostCapability(entry.requires)
      && (entry.when?.() ?? true))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

/**
 * Which carrier a kind takes. The one place the two independently-parsed manifests are held against
 * each other, and the reason a contributor does not have to know the owner's kind to declare itself.
 *
 * `items` covers two kinds because rows and annotations are both descriptors on a route; what differs
 * is the shape the host asks for and draws, which is the point's business.
 */
export const carrierFits = (kind: ExtensionPointKind, carrier: ExtensionContribution['carrier']): boolean => {
  switch (kind) {
    case 'rows':
    case 'annotation':
      return carrier === 'items'
    case 'remote':
      return carrier === 'remote'
    case 'rectangle':
      return carrier === 'frame'
    case 'hook':
      // Never on the client. A hook chain runs on the node and this registry has no part in it; the
      // entry is here only so the developer view can list it beside everything else.
      return false
  }
}

/**
 * Contributions that will never appear, and why, for the developer view (docs/plugins.md § Seeing what
 * matched).
 *
 * Silent-when-absent is right for a user and the worst possible thing for an author: a typo in `point`
 * produces an empty pane and no error. Every reason a delivery is dropped above has a case here, so
 * the two cannot drift apart.
 */
export function unmatchedExtensions(): { entry: ExtensionContribution; reason: string; suggestion?: string }[] {
  const points = extensionPointRegistry.entries()
  return extensionRegistry.entries().flatMap((entry) => {
    const point = points.find((candidate) => candidate.id === entry.point)
    // A hook's real matching happens on the node, so the client has nothing true to say about it.
    if (entry.carrier === 'route') return []
    if (!point) {
      const suggestion = nearestPointId(entry.point, points.map((candidate) => candidate.id))
      return [{
        entry,
        reason: 'no plugin on this node declares that point',
        ...(suggestion ? { suggestion } : {}),
      }]
    }
    if (!carrierFits(point.kind, entry.carrier)) {
      return [{ entry, reason: `that point takes ${point.kind}, and this contributes ${entry.carrier}` }]
    }
    if (!hasHostCapability(entry.requires)) return [{ entry, reason: 'this device cannot draw it' }]
    return []
  })
}

/**
 * The closest declared point id to one nobody declared, or `undefined` when nothing is close.
 *
 * A prefix-and-length heuristic rather than an edit distance: the typos that actually happen are a
 * misspelt half of `<owner>:<point>`, and a real Levenshtein here would suggest a stranger's point for
 * a name that shares four letters with it. `undefined` is a better answer than a wrong one.
 */
export function nearestPointId(wanted: string, declared: readonly string[]): string | undefined {
  const [owner, point] = wanted.split(':')
  return declared.find((candidate) => candidate.startsWith(`${owner}:`))
    ?? declared.find((candidate) => candidate.endsWith(`:${point}`))
}

/** Which packages a plugin's manifest says it reaches into, for the disclosure surfaces. `null` refs
 *  are dropped rather than reported, because the node refused them at parse and anything unparseable
 *  here will never deliver. */
export const extensionPointOwners = (points: readonly { point: string }[]): string[] =>
  [...new Set(points.flatMap((entry) => {
    const ref = parseExtensionPointRef(entry.point)
    return ref ? [ref.owner] : []
  }))].sort()
