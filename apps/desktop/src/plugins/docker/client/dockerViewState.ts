// Session-only docker view state (selected container per task; detail tab/scroll/find per
// container), kept outside the components so navigating away and back restores the same spot —
// the editorViewState shape. Evicted when the owning task is archived (the PreviewPane precedent:
// the plugin owns its eviction by subscribing to the core lifecycle event).
import { clientEvents } from '../../../core/client/registries/clientEvents'

export type DockerDetailTab = 'info' | 'logs' | 'stats' | 'terminal'
export type DockerDetailViewState = {
  tab: DockerDetailTab
  logScrollTop: number
  logFollow: boolean
  logQuery: string
}

const selectedByTask = new Map<string, string>()
const detailStates = new Map<string, DockerDetailViewState>()
const detailKey = (taskId: string | undefined, target: string): string => `${taskId ?? 'browse'}:${target}`

export const rememberDockerSelection = (taskId: string, containerId: string): void => {
  selectedByTask.set(taskId, containerId)
}

export const dockerSelection = (taskId: string): string | undefined => selectedByTask.get(taskId)

export const rememberDockerDetailState = (taskId: string | undefined, target: string, state: DockerDetailViewState): void => {
  detailStates.set(detailKey(taskId, target), state)
}

export const dockerDetailState = (taskId: string | undefined, target: string): DockerDetailViewState | undefined =>
  detailStates.get(detailKey(taskId, target))

clientEvents.on('runtime:task-archived', ({ taskId }) => {
  selectedByTask.delete(taskId)
  const prefix = `${taskId}:`
  for (const key of detailStates.keys()) if (key.startsWith(prefix)) detailStates.delete(key)
})
