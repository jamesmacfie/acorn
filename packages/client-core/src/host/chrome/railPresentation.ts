import { createMemo, type Accessor } from 'solid-js'
import { activeNodeId } from '../../infra/node/activeNode'
import { createFleetQuery } from '../../infra/node/fanout'
import type { RailPresentation } from '../registries/sources/sources'
import { chromeDeps, chromeKey, readRailPresentation } from './chromeData'

// A loaded source's rail presentation: its `railPresentation` route, read for as long as one rail
// button is drawn (docs/plugins/rail-presentation.md § Rail presentation).
//
// Freshness is the rest of the chrome's: the declared `refresh`, a status ping, or the plugin's own
// channel bumps `chromeDeps`, and nothing here keeps a timer. The node is the one the shell was
// mounted for, because a node switch remounts the shell. The registration hash is in the key, so an
// update, reload, or re-trust starts from nothing rather than from the previous registration's answer.

export function createPluginRailPresentation(
  pluginId: string,
  hash: string,
  sourceId: string,
  path: string,
): Accessor<RailPresentation | null> {
  const nodeId = activeNodeId() ?? ''
  const [result] = createFleetQuery(
    () => chromeKey(pluginId, `rail-presentation:${sourceId}`, hash),
    (node, _revision, signal) => readRailPresentation(pluginId, path, node, signal),
    () => chromeDeps(pluginId),
    { nodeIds: [nodeId] },
  )
  return createMemo<RailPresentation | null>(() => {
    const row = result().rows[0]
    // The fan-out serves the last answer from this node's cache when a read fails, and says so.
    if (!row) return result().unavailable.length ? { freshness: 'unavailable' } : null
    const answer = row.data
    if (!answer) return null
    const stale = row.freshness === 'stale' || row.freshness === 'offline'
    return {
      ...(answer.artwork ? { artwork: { owner: { nodeId: row.nodeId, pluginId }, image: answer.artwork } } : {}),
      ...(answer.tooltip ? { tooltip: answer.tooltip } : {}),
      ...(stale ? { freshness: 'stale' } : {}),
    }
  })
}
