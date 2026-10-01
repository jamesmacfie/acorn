import { createMemo, createRenderEffect, createResource, onCleanup } from 'solid-js'
import { closeTunnelsForTask, onPluginFrame, previewUrlForClient, readJson, remotePreviewBlocked, type Task } from '@acorn/plugin-api/client'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import type { PreviewUrlState } from '../contract/urls'
import { previewUrlRoute } from '../shared/api'
import PreviewPane from './PreviewPane'

export function PreviewTaskPane(props: { task: Task }) {
  const [resolved, { refetch }] = createResource(
    () => props.task.id,
    (taskId) => readJson<PreviewUrlState | null>(previewUrlRoute(taskId)),
  )
  onCleanup(onPluginFrame('preview', pluginChannel('preview', 'url-changed'), (payload) => {
    if ((payload as { taskId?: unknown }).taskId === props.task.id) void refetch()
  }))

  // Only a local node's URL may enter the native webview. A remote page could contact the client's
  // private network from a redirect or subrequest even if its first request used a tunnel.
  const loadable = createMemo(() => {
    if (resolved.error) return null
    const value = resolved.latest
    return previewUrlForClient(value?.taskId === props.task.id ? value.url : null)
  })

  // The listener is per (node, task, port) and outlives a pane re-render, since the pane reconciles
  // its URL often. It closes when the task does.
  //
  // The cleanup closes over the id it was registered with rather than reading `props.task` again. A
  // task switch hands those props the next task before it disposes this pane, so a fresh read in the
  // cleanup closed the tunnels of the task being opened and left the old one's listening. A pane
  // handed another task without a remount closes the old task's tunnels when the id changes. The memo
  // is what keeps a refreshed row for the same task from counting as a switch, and the render effect
  // is not held by the region's `Suspense`, so its cleanup is in place before the tunnel opens.
  const taskId = createMemo(() => props.task.id)
  createRenderEffect(() => {
    const id = taskId()
    onCleanup(() => closeTunnelsForTask(id))
  })

  return <PreviewPane taskId={props.task.id} url={loadable()} remoteBlocked={remotePreviewBlocked()} resolving={resolved.loading} resolutionFailed={!!resolved.error} retryResolution={() => void refetch()} />
}
