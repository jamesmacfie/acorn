import { createResource } from 'solid-js'
import type { Task } from '../../../core/client/queries'
import type { PaneContribution } from '../../../core/client/registries/panes'
import { terminalApi } from '../../terminal/client/terminalClient'
import { recipeBrowserUrl } from '../../../core/client/tasks/tasks'
import { runApi } from '../../terminal/client/runClient'
import PreviewPane from './PreviewPane'

export function PreviewTaskPane(props: { task: Task }) {
  const api = terminalApi()
  // Repo-level preview config (repo-level-settings): the machine-local repo_paths values. ponytail:
  // committed .acorn/config.toml preview keys drive the public-API resolver, not this in-app pane.
  const [config] = createResource(
    () => `${props.task.repoOwner}/${props.task.repoName}`,
    () => api?.repoPath.get(props.task.repoOwner, props.task.repoName) ?? null,
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
  const url = () => {
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
  return <PreviewPane taskId={props.task.id} url={url()} />
}

export const previewPaneContribution: PaneContribution = {
  id: 'preview', label: 'Browser preview', glyph: '◍', description: 'Live preview of the app', order: 80,
  defaultChord: 'meta+shift+b', requires: 'desktop', component: PreviewTaskPane,
  keepAlive: 'dom', minWidth: 320,
}
