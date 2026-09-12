import type {
  PluginCollectionPage,
  PluginCollectionParam,
  PluginCollectionSchema,
} from '@acorn/protocol/collections.ts'
import { Registry } from '../../../kit/lib/registry'

// A typed set of records a panel can be composed over (docs/dashboards.md § Collections).
//
// Two feeders, one registry, like `nodeStats` and `attention`. A compiled plugin registers through
// `ctx.collections` with a fetch of its own, and a loaded plugin declares `collections` in its
// manifest for the descriptor pass to synthesise the same contribution (plugins/chrome/register.ts).
// Nothing downstream can tell the two apart.
//
// Not merged with `nodeStats` or `attention`. A stat is one integer with a label, a collection is a
// schema plus rows, and one shape would make every stat invent an empty schema.
export type CollectionContribution = {
  // `<pluginId>:<collectionId>`, minted by `collectionKey` below and never spelled by hand. The
  // registry needs one string, and everything else addresses a collection by the pair, so both halves
  // stay readable on the contribution.
  id: string
  pluginId: string
  collectionId: string
  name: string
  // Declared inputs, passed back to `fetch` opaquely. The plugin owns their meaning.
  params?: PluginCollectionParam[]
  // Whether these rows belong to one workspace. Set, the host fills a `workspace` param with the
  // workspace of the board the panel is placed on, so the collection reads it out of `params` like any
  // other input and nothing here learns what a workspace is (dashboards/data.ts, `scopedQuery`).
  //
  // The one input the plugin cannot name itself: a definition lives in one library and the same panel
  // is placed on a board in every workspace, so a workspace written into the definition would pin
  // every board to one (docs/dashboards.md § Placements).
  workspaceScoped?: boolean
  // A param whose choices only exist on the device. github's `repo` is the repositories this user has,
  // which no static declaration can name. Absent, or answering empty, leaves the param in its declared
  // form.
  //
  // Compiled feeder only. The loaded-plugin equivalent needs a second descriptor route, a wire format,
  // a parse and a cache, for a case no manifest plugin has. The shape here is what that route would
  // answer with, so the synthesiser can fill this same function later.
  paramOptions?(paramId: string, nodeId: string): Promise<readonly { id: string; label: string }[]>
  // The static promise about what `fetch` returns, for an editor with no data yet. Absent means the
  // answer describes itself and nothing can be offered before the first read.
  schema?: PluginCollectionSchema
  // Seconds, the manifest's own bound. A hint for whatever places this collection; nothing here
  // polls.
  refresh?: number
  // Resolved against one explicitly addressed node, the rule every fan-out contribution here follows.
  // A fetcher reading the ambient active node reports one node's rows under every placement.
  fetch(nodeId: string, params: Record<string, string>, signal: AbortSignal): Promise<PluginCollectionPage>
}

/** What a plugin hands `ctx.collections.register`. The host binds the other two: `pluginId` is the
 *  registering plugin and `id` derives from it, so a collection cannot be filed under a stranger's
 *  name. */
export type CollectionRegistration = Omit<CollectionContribution, 'id' | 'pluginId'>

export const collectionKey = (pluginId: string, collectionId: string): string => `${pluginId}:${collectionId}`

export const collectionRegistry = new Registry<CollectionContribution>('collection')

export const collectionContributions = (): CollectionContribution[] =>
  [...collectionRegistry.entries()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))

export const collectionContribution = (pluginId: string, collectionId: string): CollectionContribution | undefined =>
  collectionRegistry.get(collectionKey(pluginId, collectionId))

/** The answer for "nothing to show" and for an unusable one. One value for both, because an empty
 *  table tells the reader everything either case gives them, and why a fetch produced nothing is a
 *  console line for the plugin's author. */
export const emptyCollectionPage = (): PluginCollectionPage => ({ schema: { fields: [] }, rows: [] })
