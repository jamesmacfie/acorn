import { createEffect, createMemo, createSignal, mapArray, onCleanup, type Accessor } from 'solid-js'
import type {
  PluginCollectionField,
  PluginCollectionPage,
  PluginCollectionRow,
  PluginCollectionSchema,
} from '@acorn/protocol/collections.ts'
import { activeNodeId } from '../node/activeNode'
import { createFleetQuery } from '../node/fanout'
import { clientFor } from '../node/fleet'
import type { Freshness } from '../node/freshness'
import { collectionContribution, emptyCollectionPage, type CollectionContribution } from '../registries/collections'
import { panelSchema, unionRows, type PanelSourcePage } from './mapping'
import { panelRefreshSeconds, type PanelDefinition, type PanelQuery } from './model'
import { shapeRows, visibleFields } from './shaping'

// One panel's data. Who owns which refresh knob, and why panel reads go through the fleet fan-out, are
// in docs/dashboards.md § Freshness.
//
// Fetching is per collection, and the union happens afterwards. Each source keeps its own query key, its
// own declared refresh and its own place in the cache, so two panels over the same collection share the
// read and a slow source does not hold up a fast one. The consequence that matters is partial
// availability: one source failing is data, not an error, so the panel says which source is missing and
// renders the rest, which is the fleet machinery's rule one tier down (node/fanout.ts).

/** Private to panels. The fan-out writes through the node's QueryClient, so sharing a key means sharing
 *  the value's shape (node/fanout.ts). A collection page is an aggregate nothing else in the app holds,
 *  so it gets a key of its own. Two panels over the same collection with the same params legitimately
 *  share it, since that is the same shape by construction, and different params do not. */
export const collectionQueryKey = (query: PanelQuery | undefined): readonly unknown[] => {
  if (!query) return ['collection', 'unresolved']
  const params = Object.entries(query.params ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  return ['collection', query.pluginId, query.collectionId, params]
}

/** The last page this node answered for a query, straight out of its own QueryClient.
 *
 *  The one reader outside a panel is the editor, and it is why this is exported: a collection that
 *  declares no static schema describes itself in its answer, so until this returns something there is
 *  nothing for the editor to offer filters, a grouping or a board over (editor.ts, `schemaOf`). */
export const cachedCollectionPage = (
  query: PanelQuery | undefined,
  nodeId: string,
): PluginCollectionPage | undefined =>
  // `clientFor` mints a cache and an IndexedDB persister for whatever it is handed, so an unset node id
  // would quietly create one for the empty string rather than answer "nothing cached".
  nodeId ? clientFor(nodeId).client.getQueryData<PluginCollectionPage>(collectionQueryKey(query)) : undefined

/** When that page landed, epoch milliseconds, or `undefined` for a query this device has never answered.
 *  The cache already tracks it, and the wizard's collection cards are the reader (editor.ts,
 *  `collectionCardMeta`), because "read 3 minutes ago" and "not read on this device yet" are different
 *  sentences and a row count of zero cannot tell them apart. */
export const cachedCollectionAnsweredAt = (query: PanelQuery | undefined, nodeId: string): number | undefined => {
  if (!nodeId) return undefined
  const at = clientFor(nodeId).client.getQueryState(collectionQueryKey(query))?.dataUpdatedAt
  return at || undefined
}

/** Whether a query-cache event is about a collection page. Exported for its own test: every other query
 *  on the node, repos, tasks or rail rows, ticking here would rerun the editor's derivations for nothing,
 *  and a predicate that quietly stopped matching would be invisible. */
export const isCollectionCacheKey = (key: readonly unknown[]): boolean => key[0] === 'collection'

/** A revision that ticks whenever a collection page lands in this node's cache.
 *
 *  `getQueryData` is a snapshot, and that is a real gap. The panel editor reads the answered schema out
 *  of the cache, and a collection that describes itself in its response has nothing there until a panel
 *  over it has drawn once. Without this, a first answer arriving while the editor is open, because the
 *  panel was just placed or another panel over the same collection fetched, leaves the form cold until it
 *  is closed and reopened.
 *
 *  Not the editor issuing its own fetch. Whether an editor may run a collection to learn its shape is
 *  a separate question, answered properly by a person pressing a button, and it must not be answered
 *  a second time by a side effect. */
export function createCollectionCacheRevision(nodeId: string): Accessor<number> {
  const [revision, setRevision] = createSignal(0)
  if (!nodeId) return revision
  const unsubscribe = clientFor(nodeId).client.getQueryCache().subscribe((event) => {
    if (isCollectionCacheKey(event.query.queryKey)) setRevision((value) => value + 1)
  })
  onCleanup(unsubscribe)
  return revision
}

/** One source's read, as the panel's chrome sees it. */
export type PanelSourceState = {
  query: PanelQuery
  /** `undefined` when the collection this source names is not registered on this device right now, which
   *  means a disabled or uninstalled plugin. */
  contribution: Accessor<CollectionContribution | undefined>
  page: Accessor<PluginCollectionPage>
  /** Response schema once there is one, else the collection's declared static promise. */
  schema: Accessor<PluginCollectionSchema>
  /** Whether the node answered for this source. */
  answered: Accessor<boolean>
  freshness: Accessor<Freshness | undefined>
  /** Set when the node could not answer for this source and had nothing cached. */
  reason: Accessor<string | undefined>
  refreshSeconds: Accessor<number | undefined>
}

/** A source the panel could not read. Named per source rather than per node, because on a mixed panel
 *  "linear is unavailable" is the useful sentence and "this node is unavailable" is false. */
export type PanelUnavailable = {
  query: PanelQuery
  label: string
  reason: string
}

export type PanelData = {
  sources: Accessor<PanelSourceState[]>
  /** The panel-local schema: one source's own, or the mapped union's (mapping.ts). */
  schema: Accessor<PluginCollectionSchema>
  /** Unioned, mapped, then shaped: filtered, sorted, limited. */
  rows: Accessor<PluginCollectionRow[]>
  /** Projected, in render order. */
  fields: Accessor<PluginCollectionField[]>
  /** Whether any source has answered. `false` with nothing unavailable is the loading state. */
  answered: Accessor<boolean>
  /** The oldest answer on the panel. A mixed panel is only as live as its stalest source. */
  freshness: Accessor<Freshness | undefined>
  unavailable: Accessor<PanelUnavailable[]>
  /** Seconds, or `undefined` for a panel that only refreshes when asked. The shortest of its sources',
   *  which is what the panel visibly polls at. */
  refreshSeconds: Accessor<number | undefined>
  refresh: () => void
}

// A mixed panel is as fresh as its worst source. Ordered by how much a reader should distrust what is on
// screen (node/freshness.ts). `undefined`, meaning nothing answered, never wins over a real answer.
const FRESHNESS_ORDER: Freshness[] = ['live', 'refreshing', 'disabled', 'stale', 'offline', 'error']
const worst = (values: readonly (Freshness | undefined)[]): Freshness | undefined => {
  let out: Freshness | undefined
  for (const value of values) {
    if (!value) continue
    if (!out || FRESHNESS_ORDER.indexOf(value) > FRESHNESS_ORDER.indexOf(out)) out = value
  }
  return out
}

/** One source: its contribution, its own fan-out read against the pinned node, and its own poll.
 *
 *  Created inside `mapArray`, which gives each source a root of its own, so adding or removing a source
 *  in the editor disposes exactly that source's resource and timer rather than tearing down the panel's
 *  whole read. */
function createSourceState(
  query: PanelQuery,
  nodeId: string,
  panelRefresh: Accessor<number | undefined>,
  panelRevision: Accessor<number>,
): PanelSourceState {
  const contribution = createMemo(() => collectionContribution(query.pluginId, query.collectionId))
  const refreshSeconds = createMemo(() => panelRefreshSeconds(panelRefresh(), contribution()?.refresh))

  const [revision, setRevision] = createSignal(0)
  createEffect(() => {
    const seconds = refreshSeconds()
    if (seconds === undefined) return
    const timer = setInterval(() => {
      // The rule the poller registry and the chrome revision both apply: a hidden window is not worth a
      // fetch. A manual refresh is exempt, because that one had a person behind it.
      if (typeof document !== 'undefined' && document.hidden) return
      setRevision((value) => value + 1)
    }, seconds * 1_000)
    onCleanup(() => clearInterval(timer))
  })

  const [result] = createFleetQuery(
    (_dep: { revision: number; panel: number; registered: boolean }) => collectionQueryKey(query),
    async (node, _dep, signal) => {
      const entry = collectionContribution(query.pluginId, query.collectionId)
      // Same answer for "no such collection" as for one that answered with nothing: an empty page. The
      // panel's inert chrome comes from `contribution()`, not from the shape of the data.
      if (!entry) return emptyCollectionPage()
      return entry.fetch(node, query.params ?? {}, signal)
    },
    // `registered` is in the dep so a plugin that activates after this panel mounted causes a refetch
    // rather than leaving it inert until something else moves.
    () => ({ revision: revision(), panel: panelRevision(), registered: !!contribution() }),
    { nodeIds: [nodeId] },
  )

  const row = () => result().rows[0]
  // Seeded from the cache, not just fetched into it. The fan-out already writes every answer through this
  // node's QueryClient and fleet.ts persists that to IndexedDB, but fanout.ts only reads the cache when a
  // fetch fails, so a panel remounted by navigating back to the dashboard drew "Loading…" over rows it
  // already had until the refetch landed. The last page is the honest thing to show while the new one is
  // in flight, and `row()` replaces it the moment it answers.
  //
  // Reactive on the cache revision rather than a snapshot at mount: the persister restores IndexedDB
  // after the first paint, so a panel on a cold boot mounts before its own cached page is back.
  const cacheRevision = createCollectionCacheRevision(nodeId)
  const cached = createMemo(() => {
    cacheRevision()
    return cachedCollectionPage(query, nodeId)
  })
  const page = createMemo((): PluginCollectionPage => row()?.data ?? cached() ?? emptyCollectionPage())
  const schema = createMemo(() => {
    const answer = page().schema
    return answer.fields.length ? answer : contribution()?.schema ?? answer
  })

  return {
    query,
    contribution,
    page,
    schema,
    // A cached page counts as answered: there are rows to draw. `refreshing` is what that word is for in
    // the vocabulary, data on screen with a read in flight (node/freshness.ts).
    answered: () => !!row() || !!cached(),
    freshness: () => row()?.freshness ?? (cached() ? 'refreshing' : undefined),
    reason: () => result().unavailable[0]?.reason,
    refreshSeconds,
  }
}

export function createPanelData(definition: Accessor<PanelDefinition>): PanelData {
  // Captured at creation rather than read per render: a node switch swaps the QueryClient provider this
  // tree sits under, which remounts it (plugins/chrome/ChromeSourcePanel.tsx says the same).
  const nodeId = activeNodeId() ?? ''

  const [revision, setRevision] = createSignal(0)
  const refresh = () => void setRevision((value) => value + 1)

  const queries = createMemo(() => definition().queries)
  const panelRefresh = () => definition().refresh
  const sources = createMemo(
    mapArray(queries, (query) => createSourceState(query, nodeId, panelRefresh, revision)),
  )

  const pages = createMemo((): PanelSourcePage[] =>
    sources().map((source) => ({ query: source.query, schema: source.schema(), rows: source.page().rows })))

  const schema = createMemo(() => panelSchema(pages(), definition().mapping))
  const united = createMemo(() => unionRows(pages(), definition().mapping))

  return {
    sources,
    schema,
    rows: createMemo(() => shapeRows(united(), schema(), definition().shaping)),
    fields: createMemo(() => visibleFields(schema(), definition().shaping)),
    answered: () => sources().some((source) => source.answered()),
    freshness: () => worst(sources().map((source) => source.freshness())),
    // Partial availability is data. One source that could not be read leaves the others rendering, and
    // the panel says which one is missing rather than blanking.
    unavailable: () => sources().flatMap((source) => {
      const reason = source.reason()
      if (!reason) return []
      const label = source.contribution()?.name ?? source.query.collectionId
      return [{ query: source.query, label: `${source.query.pluginId} · ${label}`, reason }]
    }),
    refreshSeconds: () => {
      const seconds = sources().flatMap((source) => source.refreshSeconds() ?? [])
      return seconds.length ? Math.min(...seconds) : undefined
    },
    refresh,
  }
}
