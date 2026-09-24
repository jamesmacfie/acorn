import { createMemo, createRenderEffect, createResource, onCleanup } from 'solid-js'
import { closeTunnelsForTask, onPluginFrame, type PaneLayoutContribution, readJson, type Task, tunnelUrl } from '@acorn/plugin-api/client'
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

  // The URL this machine can actually load. For the bundled local node the two are identical. For a
  // remote one, a loopback URL is rewritten to a tunnel port that main opens over the authenticated
  // connection (client-core's node/tunnelUrl.ts). This is a resource because opening the tunnel is a
  // round trip.
  const [loadable] = createResource(
    () => ({ taskId: props.task.id, url: resolved()?.url ?? null }),
    ({ taskId, url }) => tunnelUrl(taskId, url),
  )

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

  return <PreviewPane taskId={props.task.id} url={loadable() ?? null} />
}

export const previewPaneContribution: PaneLayoutContribution = {
  id: 'preview', label: 'Browser preview', glyph: 'globe', description: 'Live preview of the app', order: 80,
  // The gate is the seam that actually backs the pane, not "am I the desktop" (docs/frontend.md §
  // The desktop gate audit). The pane is a WebContentsView the shell positions over the client, and
  // a desktop shell may ship without preview views — so a host that has not installed the group
  // never lists the pane at all, rather than listing it and then saying it cannot draw it.
  defaultChord: 'meta+shift+b', requires: { seam: 'preview' },
  // `single`, so the pane inherits the host's frame, focus group and padding rules rather than the
  // `<section class="pane workspace-preview">` it used to write for itself.
  layout: 'single', regions: { body: PreviewTaskPane },
  minWidth: 320,
}
