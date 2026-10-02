import { createMemo, createRenderEffect, createResource, onCleanup } from 'solid-js'
import { activeNodeId, closeTunnelsForTask, onPluginFrame, previewUrlForClient, readJson, remotePreviewBlocked, type Task } from '@acorn/plugin-api/client'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import type { PreviewUrlState } from '../contract/urls'
import { previewUrlRoute } from '../shared/api'
import PreviewPane from './PreviewPane'

export function PreviewTaskPane(props: { task: Task }) {
  const taskId = createMemo(() => props.task.id)
  const owner = createMemo(() => ({ taskId: taskId(), nodeId: activeNodeId() }))
  const [resolved, { refetch }] = createResource(owner, async (origin) => ({
    origin,
    state: await readJson<PreviewUrlState | null>(previewUrlRoute(origin.taskId), { nodeId: origin.nodeId }),
  }))
  onCleanup(onPluginFrame('preview', pluginChannel('preview', 'url-changed'), (payload) => {
    if ((payload as { taskId?: unknown }).taskId === props.task.id) void refetch()
  }))

  // Only a local node's URL may enter the native webview. A remote page could contact the client's
  // private network from a redirect or subrequest even if its first request used a tunnel.
  const loadable = createMemo(() => {
    if (resolved.error) return null
    const value = resolved.latest
    return previewUrlForClient(value?.origin === owner() && value.state?.taskId === props.task.id ? value.state.url : null, owner().nodeId)
  })

  // Cleanup captures the outgoing Node/task even when the shell updates props before disposal.
  createRenderEffect(() => {
    const origin = owner()
    onCleanup(() => closeTunnelsForTask(origin.taskId, origin.nodeId))
  })

  return <PreviewPane taskId={props.task.id} url={loadable()} remoteBlocked={remotePreviewBlocked(owner().nodeId)} resolving={resolved.loading} resolutionFailed={!!resolved.error} retryResolution={() => void refetch()} />
}
