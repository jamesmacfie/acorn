// Signals-only store for the docker surface: the container list and daemon availability, refreshed on
// demand and on the `docker:changed` WS edge. Event-driven, with no client polling loop, because the
// node's events watcher is the source of truth for freshness. Live daemon state deliberately
// stays out of the persisted query cache.
import { createSignal } from 'solid-js'
import { wsOnReconnect, type ClientScheduleContribution } from '@acorn/plugin-api/client'
import { captureDockerScope, onDockerRetired } from './dockerScope'
import { wsOnDockerChanged } from './wsChannel'
import type { DockerContainerSummary, DockerInfo, DockerTaskSummary } from '../shared/model'
import { fetchContainers, fetchDockerInfo, fetchTaskSummaries } from './dockerClient'

const [containers, setContainers] = createSignal<DockerContainerSummary[]>([])
const [dockerInfo, setDockerInfo] = createSignal<DockerInfo | null>(null)
const [loading, setLoading] = createSignal(false)
const [loadError, setLoadError] = createSignal('')

let inflight: Promise<void> | null = null
let offRefresh: (() => void) | undefined

export { containers, dockerInfo, loading, loadError }

export async function refreshDocker(force = false): Promise<void> {
  if (inflight && !force) return inflight
  const owner = captureDockerScope()
  setLoading(true)
  const pending = Promise.resolve().then(async () => {
    try {
      const info = await fetchDockerInfo(owner.nodeId)
      if (!owner.current() || inflight !== pending) return
      setDockerInfo(info)
      if (info.available) {
        const list = await fetchContainers(owner.nodeId)
        if (!owner.current() || inflight !== pending) return
        setContainers(list)
      }
      setLoadError('')
    } catch (e) {
      if (owner.current() && inflight === pending) setLoadError(e instanceof Error ? e.message : 'Could not reach the docker routes.')
    } finally {
      if (inflight === pending) {
        setLoading(false)
        inflight = null
      }
    }
  })
  inflight = pending
  return pending
}

// The first consumer wires the WS edge for the app's lifetime. The subscription is idempotent and the
// socket is shared, so there's nothing to tear down per component.
export function wireDockerRefresh(): void {
  if (offRefresh) return
  const offChanged = wsOnDockerChanged((scopes) => {
    if (scopes.includes('containers')) void refreshDocker(true)
  })
  const offReconnect = wsOnReconnect(() => void refreshDocker(true))
  offRefresh = () => { offChanged(); offReconnect() }
}

export function disposeDockerStore(): void {
  offRefresh?.()
  offRefresh = undefined
}

// ── Task and container summaries: rail and footer badges, pane gating, archive concern ────────────
// Polled like taskStatus.ts, because containers can change without docker events reaching us after a
// reconnect, plus the docker:changed edge for immediacy.
const [taskSummaries, setTaskSummaries] = createSignal<Record<string, DockerTaskSummary>>({})

export const dockerTaskSummary = (taskId: string): DockerTaskSummary | undefined => taskSummaries()[taskId]

let summaryInflight: Promise<void> | null = null
export async function refreshDockerTaskSummaries(): Promise<void> {
  if (summaryInflight) return summaryInflight
  const owner = captureDockerScope()
  const pending = fetchTaskSummaries(owner.nodeId).then((list) => {
    if (!owner.current()) return
    setTaskSummaries((current) => {
      if (Object.keys(current).length === list.length && list.every((summary) => {
        const previous = current[summary.taskId]
        return previous && previous.total === summary.total && previous.running === summary.running
          && previous.projects.length === summary.projects.length
          && previous.projects.every((project, index) => project === summary.projects[index])
      })) return current
      return Object.fromEntries(list.map((summary) => [summary.taskId, summary]))
    })
  }).catch(() => {
    // A failed observation cannot authorize removing last-known task links.
  }).finally(() => { if (summaryInflight === pending) summaryInflight = null })
  summaryInflight = pending
  return pending
}

onDockerRetired(() => {
  inflight = null
  summaryInflight = null
  setContainers([])
  setDockerInfo(null)
  setLoadError('')
  setLoading(false)
  setTaskSummaries({})
})

export const dockerTaskScheduleContribution: ClientScheduleContribution = {
  id: 'docker.task-containers',
  intervalMs: 15_000,
  run: refreshDockerTaskSummaries,
  subscribe: (refresh) => wsOnDockerChanged((scopes) => {
    if (scopes.includes('containers')) refresh()
  }),
}
