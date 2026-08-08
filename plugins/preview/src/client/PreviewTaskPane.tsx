import { createResource, onCleanup } from 'solid-js'
import type { Task } from '@acorn/client-core/queries.ts'
import type { PaneContribution } from '@acorn/client-core/registries/panes.ts'
import { taskBridge } from '@acorn/client-core/tasks/taskBridge.ts'
import { recipeBrowserUrl } from '@acorn/client-core/tasks/tasks.ts'
import { runApi } from '@acorn/client-core/tasks/runClient.ts'
import { closeTunnelsForTask, tunnelUrl } from '@acorn/client-core/node/tunnelUrl.ts'
import PreviewPane from './PreviewPane'

export function PreviewTaskPane(props: { task: Task }) {
  const api = taskBridge()
  const [config] = createResource(
    () => props.task.projectId,
    async () => api ? (await api.project.get(props.task.projectId))?.config ?? null : null,
  )
  const [targets] = createResource(
    () => props.task.id,
    async (taskId) => {
      if (!api) return []
      const result = await runApi.targets(taskId)
      return 'targets' in result ? result.targets : []
    },
  )
  const [runUrl] = createResource(
    () => ({ id: props.task.id, running: (targets() ?? []).map((target) => `${target.id}:${target.running}`).join(',') }),
    async ({ id }) => (api ? ((await runApi.defaultUrl(id)) ?? null) : null),
  )
  const [scriptUrl] = createResource(
    () => {
      const current = config()
      return current?.previewMode === 'script' && current.previewValue
        ? { taskId: props.task.id, script: current.previewValue }
        : null
    },
    async ({ taskId, script }) => {
      if (!api) return null
      const result = await api.previewUrl(taskId, script)
      return result.ok ? (result.url ?? null) : null
    },
  )
  // The URL as the NODE resolves it. Every branch produces a value that means something on the node's own
  // machine — `previewMode: 'port'` literally builds a localhost URL here.
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

  // …and the URL this machine can actually load. For the bundled local node the two are identical; for a
  // remote one a loopback URL is rewritten to a tunnel port that main opens over the authenticated
  // connection (client-core's node/tunnelUrl.ts). A resource, because opening the tunnel is a round trip.
  const [loadable] = createResource(
    () => ({ taskId: props.task.id, url: nodeUrl() }),
    ({ taskId, url }) => tunnelUrl(taskId, url),
  )

  // The listener is per (node, task, port) and outlives a pane re-render on purpose — the pane reconciles
  // its URL often. It goes when the task does.
  onCleanup(() => closeTunnelsForTask(props.task.id))

  return <PreviewPane taskId={props.task.id} url={loadable() ?? null} />
}

export const previewPaneContribution: PaneContribution = {
  id: 'preview', label: 'Browser preview', glyph: 'globe', description: 'Live preview of the app', order: 80,
  defaultChord: 'meta+shift+b', requires: 'desktop', component: PreviewTaskPane,
  keepAlive: 'dom', minWidth: 320,
}
