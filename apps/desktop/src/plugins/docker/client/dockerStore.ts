// Signals-only store for the docker surface: the container list + daemon availability, refreshed
// on demand and on the `docker:changed` WS edge (event-driven — no client polling loop; the main
// process's events watcher is the source of truth for freshness). Live daemon state deliberately
// stays out of the persisted query cache.
import { createSignal } from 'solid-js'
import { latestOnly } from '../../../core/client/lib/latestOnly'
import type { PollerContribution } from '../../../core/client/registries/pollers'
import { wsOnDockerChanged } from '../../../core/client/wsClient'
import type { DockerContainerSummary, DockerInfo, DockerTaskSummary } from '../shared/model'
import { fetchContainers, fetchDockerInfo, fetchTaskSummaries } from './dockerClient'

const [containers, setContainers] = createSignal<DockerContainerSummary[]>([])
const [dockerInfo, setDockerInfo] = createSignal<DockerInfo | null>(null)
const [loading, setLoading] = createSignal(false)
const [loadError, setLoadError] = createSignal('')

let inflight: Promise<void> | null = null
let wsWired = false

export { containers, dockerInfo, loading, loadError }

export async function refreshDocker(): Promise<void> {
  if (inflight) return inflight
  setLoading(true)
  inflight = (async () => {
    try {
      const info = await fetchDockerInfo()
      setDockerInfo(info)
      setContainers(info.available ? await fetchContainers() : [])
      setLoadError('')
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not reach the docker routes.')
    } finally {
      setLoading(false)
      inflight = null
    }
  })()
  return inflight
}

// First consumer wires the WS edge for the app's lifetime — the subscription is idempotent and the
// socket is shared, so there's nothing to tear down per-component.
export function wireDockerRefresh(): void {
  if (wsWired) return
  wsWired = true
  wsOnDockerChanged((scopes) => {
    if (scopes.includes('containers')) void refreshDocker()
  })
}

// ── Task↔container summaries (rail/footer badges, pane gating, archive concern) ──────────────────
// Polled like taskStatus.ts (containers can change without docker events reaching us after a
// reconnect), plus the docker:changed edge for immediacy.
const [taskSummaries, setTaskSummaries] = createSignal<Record<string, DockerTaskSummary>>({})

export const dockerTaskSummary = (taskId: string): DockerTaskSummary | undefined => taskSummaries()[taskId]

export const refreshDockerTaskSummaries = latestOnly(
  () => fetchTaskSummaries().catch(() => [] as DockerTaskSummary[]), // unavailable daemon → no links
  (list) => setTaskSummaries(Object.fromEntries(list.map((s) => [s.taskId, s]))),
)

export const dockerTaskPollerContribution: PollerContribution = {
  id: 'docker.task-containers',
  intervalMs: 10_000,
  run: refreshDockerTaskSummaries,
  subscribe: (refresh) => wsOnDockerChanged((scopes) => {
    if (scopes.includes('containers')) refresh()
  }),
}
