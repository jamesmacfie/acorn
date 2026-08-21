import { createResource, onCleanup } from 'solid-js'
import { closeTunnelsForTask, type PaneContribution, recipeBrowserUrl, runApi, type Task, taskBridge, tunnelUrl } from '@acorn/plugin-api/client'
import PreviewPane from './PreviewPane'

export function PreviewTaskPane(props: { task: Task }) {
  const api = taskBridge()
  const [config] = createResource(
    () => props.task.projectId,
    async () => (await api.project.get(props.task.projectId))?.config ?? null,
  )
  const [targets] = createResource(
    () => props.task.id,
    async (taskId) => {
      const result = await runApi.targets(taskId)
      return 'targets' in result ? result.targets : []
    },
  )
  const [runUrl] = createResource(
    () => ({ id: props.task.id, running: (targets() ?? []).map((target) => `${target.id}:${target.running}`).join(',') }),
    async ({ id }) => (await runApi.defaultUrl(id)) ?? null,
  )
  const [scriptUrl] = createResource(
    () => {
      const current = config()
      return current?.previewMode === 'script' && current.previewValue
        ? { taskId: props.task.id, script: current.previewValue }
        : null
    },
    async ({ taskId, script }) => {
      const result = await api.previewUrl(taskId, script)
      return result.ok ? (result.url ?? null) : null
    },
  )
  // The URL as the node resolves it. Every branch produces a value that means something on the
  // node's own machine: previewMode: 'port' builds a localhost URL here.
  const nodeUrl = () => {
    const recipe = recipeBrowserUrl(props.task.id)
    if (recipe) return recipe
    if (runUrl()) return runUrl()!
    const current = config()
    const value = current?.previewValue?.trim() || null
    if (current?.previewMode === 'url') return value
    if (current?.previewMode === 'port') {
      const port = Number(value)
      return value && Number.isInteger(port) && port >= 1 && port <= 65535 ? `http://localhost:${port}` : null
    }
    return current?.previewMode === 'script' ? (scriptUrl() ?? null) : null
  }

  // The URL this machine can actually load. For the bundled local node the two are identical. For a
  // remote one, a loopback URL is rewritten to a tunnel port that main opens over the authenticated
  // connection (client-core's node/tunnelUrl.ts). This is a resource because opening the tunnel is a
  // round trip.
  const [loadable] = createResource(
    () => ({ taskId: props.task.id, url: nodeUrl() }),
    ({ taskId, url }) => tunnelUrl(taskId, url),
  )

  // The listener is per (node, task, port) and outlives a pane re-render, since the pane reconciles
  // its URL often. It closes when the task does.
  onCleanup(() => closeTunnelsForTask(props.task.id))

  return <PreviewPane taskId={props.task.id} url={loadable() ?? null} />
}

export const previewPaneContribution: PaneContribution = {
  id: 'preview', label: 'Browser preview', glyph: 'globe', description: 'Live preview of the app', order: 80,
  defaultChord: 'meta+shift+b', requires: 'desktop', component: PreviewTaskPane,
  keepAlive: 'dom', minWidth: 320,
}
