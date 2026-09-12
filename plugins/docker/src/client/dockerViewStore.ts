// Session-only docker view state (selected container per task; detail tab/scroll/find per
// container), kept outside the components so navigating away and back restores the same spot, the
// same shape as editorViewState. Evicted when the owning task is archived (the PreviewPane
// precedent: the plugin owns its eviction by subscribing to the core lifecycle event).
import { createSignal } from 'solid-js'
import { clientEvents } from '@acorn/plugin-api/client'
import type { DockerScope } from '../shared/model'

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

// ── "Show me this one" ────────────────────────────────────────────────────────────────────────────
//
// A resource somebody named somewhere else — the palette's `docker.find` (./commands.ts) — and where
// the browse surface should land when it next draws.
//
// A signal rather than a pane intent, because the four lists are the rail source's and not a pane's:
// a container belongs to a task, but an image, a volume and a network belong to the daemon, and the
// pane only ever draws this task's containers (./paneContribution.ts). The browse surface consumes
// this whether it is already mounted or opens because of it, which is the same "the destination may
// not exist yet" problem `consumePaneIntent` solves for a pane.
export type DockerReveal = { scope: DockerScope; id: string }

const [pendingReveal, setPendingReveal] = createSignal<DockerReveal | null>(null)

export const revealDockerResource = (scope: DockerScope, id: string): void => {
  setPendingReveal({ scope, id })
}

/** What to land on, once. Read reactively by the browse surface; taking it clears it, so a later
 *  remount does not jump somewhere the reader has since navigated away from. */
export const consumeDockerReveal = (): DockerReveal | null => {
  const reveal = pendingReveal()
  if (reveal) setPendingReveal(null)
  return reveal
}

/** The signal itself, for a surface that wants to react to a reveal arriving while it is on screen. */
export const dockerReveal = pendingReveal

clientEvents.on('runtime:task-archived', ({ taskId }) => {
  selectedByTask.delete(taskId)
  const prefix = `${taskId}:`
  for (const key of detailStates.keys()) if (key.startsWith(prefix)) detailStates.delete(key)
})

// A container state's StatusDot tone. One mapping for the browse list, the task pane, and the detail
// header, which otherwise each render `.docker-dot[data-state]` and rely on one stylesheet agreeing.
export const containerTone = (state: string): 'ok' | 'warn' | 'danger' | 'muted' =>
  state === 'running' ? 'ok'
  : state === 'paused' || state === 'restarting' ? 'warn'
  : state === 'exited' || state === 'dead' ? 'danger'
  : 'muted'
