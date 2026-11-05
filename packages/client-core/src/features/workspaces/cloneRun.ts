import { createSignal, onCleanup } from 'solid-js'
import {
  CLONE_RUN_WAIT_MS,
  cloneOutcome,
  projectCloneRunRoute,
  projectCloneRunsRoute,
  type CloneResult,
  type CloneRun,
  type CloneRunStart,
} from '@acorn/protocol/api.ts'
import { ApiError, postJson, readJson } from '../../infra/node/apiClient'

// A clone form's side of a clone run (docs/workspaces-and-tasks/clone-runs.md). The Node clones in
// the background, so the form only follows the run. When the form stops following, because it closed
// or the Node changed, the clone carries on, and the project appears in the list when it finishes.

export type CloneRequest = { url: string; parentDir: string; name: string; workspaceId?: string }

// The last parent folder typed, and the Node it belongs to. A path means nothing on another Node, so
// a form opened on a different Node starts empty.
let lastParent: { nodeId: string | null; path: string } | null = null
export const lastCloneParent = (nodeId: string | null): string => (lastParent?.nodeId === nodeId ? lastParent.path : '')

/** "8s" or "1m 12s". */
const cloneElapsed = (ms: number): string => {
  const seconds = Math.floor(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/** One form's clone. `start` resolves the outcome, or null once the form stops following, which
 *  disposing the owner does. `elapsed` is null while nothing runs. */
export function createCloneRun() {
  const [startedAt, setStartedAt] = createSignal<number | null>(null)
  const [now, setNow] = createSignal(0)
  let following: AbortController | undefined
  let tick: ReturnType<typeof setInterval> | undefined
  onCleanup(() => {
    following?.abort()
    clearInterval(tick)
  })

  async function start(nodeId: string | null, request: CloneRequest): Promise<CloneResult | null> {
    const run = (following = new AbortController())
    lastParent = { nodeId, path: request.parentDir }
    setNow(Date.now())
    setStartedAt(now())
    tick = setInterval(() => setNow(Date.now()), 1000)
    try {
      const { cloneId } = await postJson<CloneRunStart>(projectCloneRunsRoute, request)
      const result = await cloneOutcome(() =>
        readJson<CloneRun>(`${projectCloneRunRoute(cloneId)}?waitMs=${CLONE_RUN_WAIT_MS}`, {
          nodeId,
          signal: run.signal,
          long: true,
        }),
      )
      return run.signal.aborted ? null : result
    } catch (cause) {
      if (run.signal.aborted) return null
      // A Node from before clone runs has no route for them. Mixed-version path until 2027-02-04.
      if (cause instanceof ApiError && cause.status === 404)
        return { ok: false, error: "This Node can't clone from a URL. Update it, then try again." }
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
    } finally {
      clearInterval(tick)
      setStartedAt(null)
    }
  }

  const elapsed = () => {
    const at = startedAt()
    return at === null ? null : cloneElapsed(now() - at)
  }
  return { start, elapsed }
}
