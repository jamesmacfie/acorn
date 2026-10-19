import { createMemo } from 'solid-js'
import { useParams } from '@solidjs/router'
import type { PluginSourceDescriptor } from '@acorn/protocol/api.ts'
import { createFleetQuery } from '../../infra/node/fanout'
import { createActiveWorkspaceId } from '../../features/workspaces/activeWorkspaceId'
import { chromeDeps, chromeKey, readRailItems, scopedSourceItemsPath, type SourceScope } from './chromeData'

/**
 * A descriptor source's rail rows, read the same way by the desktop and terminal hosts, so a list drawn
 * in one and the same list drawn in the other share a route and a cache entry.
 *
 * The fan-out rather than a bare resource, pinned to one node: it is the only reader with a per-node
 * deadline, a cache fallback and the live/stale/offline vocabulary. The scope rides in the dependency
 * rather than being read inside the fetch, so it reaches the cache key as well as the path. The fan-out
 * serves its last answer on mount, so both have to agree.
 *
 * A source that declares neither `projectScoped` nor `workspaceScoped` has no scope. Its rows are the
 * same rows everywhere, so carrying the project would split one cache entry into one per project and
 * refetch the identical list on every switch.
 *
 * `scope` is `undefined` while a workspace-scoped source has no workspace. Then no route is called, and
 * the list answers empty, so the source draws its empty state.
 */
export function createSourceItems(pluginId: string, descriptor: PluginSourceDescriptor, nodeId: string) {
  const params = useParams()
  // A memo, so the list refetches when the workspace changes, not whenever the task list it is read from does.
  const workspaceId = createMemo(createActiveWorkspaceId())
  const scope = (): SourceScope | undefined => {
    if (descriptor.projectScoped) return { projectId: params.projectId }
    if (!descriptor.workspaceScoped) return {}
    const workspace = workspaceId()
    return workspace ? { workspaceId: workspace } : undefined
  }
  const [result, { refetch }] = createFleetQuery(
    ({ scope }) => chromeKey(pluginId, descriptor.id, scope?.projectId ?? scope?.workspaceId),
    (node, { scope }, signal) =>
      scope
        ? readRailItems(pluginId, scopedSourceItemsPath(descriptor.items!, scope), node, signal)
        : Promise.resolve([]),
    () => ({ revision: chromeDeps(pluginId), scope: scope() }),
    { nodeIds: [nodeId] },
  )
  return { scope, result, refetch }
}
