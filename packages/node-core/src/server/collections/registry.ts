import {
  MAX_COLLECTION_PARAMS,
  pluginCollectionResponseSchema,
  type PluginCollectionPage,
  type PluginCollectionParam,
} from '@acorn/protocol/collections.ts'
import type { Env } from '../../main/bindings'
import { dispatchPluginRoute } from '../plugin/dispatch'

// Reading a collection from the node with no client attached: docs/schedules.md § Reading a
// collection from the node.

/** What the node needs to read one collection: whose it is, and the route that answers. */
export type CollectionRead = {
  pluginId: string
  collectionId: string
  /** `GET ?<declared params>` → `{ schema, rows }`. Confined to the plugin's own namespace on every
   *  call, not merely at registration. */
  items: string
  /** Declared inputs, so a caller with no client can tell a real param from a typo. Advisory: params
   *  are passed through opaquely and the plugin owns their meaning. */
  params?: readonly PluginCollectionParam[]
}

/** What a plugin hands `ctx.collections.register` node-side. The host binds `pluginId` from the
 *  registering plugin, so a collection cannot be filed under a stranger's name. This is the node's
 *  half of the rule that keeps a descriptor route inside its own namespace. */
export type CollectionReadRegistration = Omit<CollectionRead, 'pluginId'>

const key = (pluginId: string, collectionId: string): string => `${pluginId}:${collectionId}`

// A module singleton, like the route registry and the agent-tool registry beside it. Same lifecycle
// consequence, and the same answer: the plugin host clears a plugin's entries before re-registering
// them, so a reload or a disable does not leave a pointer at a route nothing serves.
const reads = new Map<string, CollectionRead>()

export function registerCollectionRead(read: CollectionRead): void {
  const id = key(read.pluginId, read.collectionId)
  const clash = reads.get(id)
  if (clash && clash.items !== read.items) {
    throw new Error(`Duplicate collection '${id}': already registered for ${clash.items}, now for ${read.items}.`)
  }
  reads.set(id, read)
}

export function clearCollectionReads(pluginId: string): void {
  for (const [id, read] of reads) if (read.pluginId === pluginId) reads.delete(id)
}

export const collectionRead = (pluginId: string, collectionId: string): CollectionRead | undefined =>
  reads.get(key(pluginId, collectionId))

/** Every collection this node can read, for a caller enumerating rather than addressing one. */
export const collectionReads = (): CollectionRead[] =>
  [...reads.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId) || a.collectionId.localeCompare(b.collectionId))

/** Why a read produced nothing, in the words a run row can carry. `null` rows are never a substitute:
 *  a source that could not answer is a different fact from a source that answered with none, and the
 *  sampler's all-sources-answered gate turns on exactly that difference. */
export class CollectionReadError extends Error {}

/** Read one collection as this node. Throws `CollectionReadError` when the route is unregistered, the
 *  plugin refuses, or the answer does not parse.
 *
 *  The answer is parsed on both feeders' behalf, which is not the asymmetry it looks like next to the
 *  client path. There, a compiled plugin's `fetch` returns typed TypeScript from this repo, so there
 *  is nothing to validate. Here both feeders come back as JSON off a `Response`, so a parse is the
 *  only boundary available and applying it uniformly costs one schema call. Provenance is stamped by
 *  the host from the contribution that answered. A row never names its own source, even when the
 *  source is us. */
export async function readCollection(
  env: Env,
  pluginId: string,
  collectionId: string,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<PluginCollectionPage> {
  const read = reads.get(key(pluginId, collectionId))
  if (!read) throw new CollectionReadError(`no collection '${collectionId}' is registered for '${pluginId}'`)

  // The manifest's own bound on declared inputs, applied to what is actually sent: a stored panel
  // query is user data, and a query string built from an unbounded record is a way to make a plugin's
  // own route expensive on a schedule nobody is watching.
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(params).slice(0, MAX_COLLECTION_PARAMS)) query.set(name, value)
  const path = query.size ? `${read.items}${read.items.includes('?') ? '&' : '?'}${query}` : read.items

  let response: Response
  try {
    response = await dispatchPluginRoute(env, pluginId, path, { method: 'GET' }, signal)
  } catch (error) {
    throw new CollectionReadError(error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) throw new CollectionReadError(`${response.status} from ${read.items}`)

  const body: unknown = await response.json().catch(() => null)
  const parsed = pluginCollectionResponseSchema.safeParse(body)
  // Dropped whole on failure, never row by row: a partially-parsed page is a page whose row count is
  // a property of the parser, and the one number this exists to feed is a count.
  if (!parsed.success) throw new CollectionReadError(`${pluginId}:${collectionId} answered with something that is not a collection`)
  return {
    schema: parsed.data.schema,
    rows: parsed.data.rows.map((row) => ({ ...row, pluginId, collectionId })),
  }
}
