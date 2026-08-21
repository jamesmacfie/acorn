import type {
  PluginCollectionPage,
  PluginCollectionParam,
  PluginCollectionSchema,
} from '@acorn/protocol/collections.ts'
import { Registry } from './registry'

// A typed set of records a panel can be composed over (docs/dashboards.md § Collections).
//
// Two feeders, one registry, exactly as `nodeStats` and `attention` have: a compiled plugin registers
// through `ctx.collections` with a fetch of its own, and a loaded plugin declares `collections` in
// its manifest and the descriptor pass synthesises the same contribution over the host's reader
// (plugins/chrome/register.ts). Nothing downstream can tell which feeder a collection came from,
// which is the point.
//
// Not merged with `nodeStats` or `attention`: a stat is one integer with a label, a collection is a
// schema plus rows. Forcing them into one shape would mean every stat inventing an empty schema.
export type CollectionContribution = {
  // `<pluginId>:<collectionId>`, minted by `collectionKey` below and never spelled by hand. The
  // registry needs one string; everything else addresses a collection as `(pluginId, collectionId)`
  // and by nothing else, so the two halves stay separately readable on the contribution.
  id: string
  pluginId: string
  collectionId: string
  name: string
  // Declared inputs, passed back to `fetch` opaquely. The plugin owns their meaning.
  params?: PluginCollectionParam[]
  // A param whose choices only exist on the device: github's `repo` is the repositories this user
  // has, which no static declaration can name. Absent, or answering empty, leaves the param as its
  // declared form, a text box or a select over its declared values.
  //
  // Compiled feeder only: the loaded-plugin equivalent is a second descriptor route for the host to
  // read, a wire format, a parse and a cache for a case no manifest plugin has yet. The shape here is
  // the one that route would answer with, so the day one exists the synthesiser fills this same
  // function and nothing downstream changes.
  paramOptions?(paramId: string, nodeId: string): Promise<readonly { id: string; label: string }[]>
  // The static promise about what `fetch` returns, for an editor with no data yet. Absent means
  // response-only: the answer describes itself and nothing can be offered before the first read.
  schema?: PluginCollectionSchema
  // Seconds, the manifest's own bound. A hint for whatever places this collection; nothing here
  // polls.
  refresh?: number
  // Resolved against one node, addressed explicitly, the same rule every fan-out contribution here
  // states. A fetcher that read the ambient active node would report one node's rows under every
  // placement the moment a panel is drawn per node.
  fetch(nodeId: string, params: Record<string, string>, signal: AbortSignal): Promise<PluginCollectionPage>
}

/** What a plugin hands `ctx.collections.register`. The host binds the other two: `pluginId` is the
 *  registering plugin and `id` is derived from it, so a collection cannot be filed under a stranger's
 *  name, the client's half of the rule that stops a descriptor route leaving its own namespace. */
export type CollectionRegistration = Omit<CollectionContribution, 'id' | 'pluginId'>

export const collectionKey = (pluginId: string, collectionId: string): string => `${pluginId}:${collectionId}`

export const collectionRegistry = new Registry<CollectionContribution>('collection')

export const collectionContributions = (): CollectionContribution[] =>
  [...collectionRegistry.entries()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))

export const collectionContribution = (pluginId: string, collectionId: string): CollectionContribution | undefined =>
  collectionRegistry.get(collectionKey(pluginId, collectionId))

/** The answer for "nothing to show", and the answer for an unusable one. The same value for both:
 *  a panel that renders an empty table has told the reader everything either case gives it,
 *  and the reason a fetch produced nothing is a console line for the plugin's author, not a second
 *  empty state for the reader to interpret. */
export const emptyCollectionPage = (): PluginCollectionPage => ({ schema: { fields: [] }, rows: [] })
