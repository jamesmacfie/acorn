import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { TASK_IDS_PER_READ } from '@acorn/protocol/task.ts'
import {
  taskScriptsBatchRoute,
  taskScriptsBatchSchema,
  taskScriptsKey,
  taskScriptsRoute,
  taskScriptsStatusSchema,
  type TaskScriptSnapshot,
  type TaskScriptsStatus,
} from '@acorn/protocol/taskScripts.ts'
import { ApiError, readJson } from '../../infra/node/apiClient'
import { activeCacheId, activeNodeId } from '../../infra/node/activeNode'
import { clientFor, nodeState } from '../../infra/node/fleet'
import { freshnessOf } from '../../infra/node/freshness'

export function createTaskScripts(taskId: () => string) {
  const query = createQuery(() => ({
    queryKey: [...taskScriptsKey, taskId()],
    queryFn: async ({ signal }) =>
      taskScriptsStatusSchema.parse(await readJson(taskScriptsRoute(taskId()), { signal })),
    refetchInterval: 15_000,
    staleTime: 20_000,
  }))
  const freshness = () => freshnessOf(nodeState(activeNodeId() ?? ''), query)
  return { query, freshness }
}

// A Node from before the batched route answers 404, so it's asked task by task, as it was then.
// Mixed-version path until 2027-01-19.
async function readTaskScriptsBatch(ids: readonly string[], signal: AbortSignal): Promise<unknown> {
  try {
    return await readJson(taskScriptsBatchRoute(ids), { signal })
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error
    const answers = await Promise.allSettled(ids.map((id) => readJson(taskScriptsRoute(id), { signal })))
    return Object.fromEntries(
      answers.flatMap((answer, index) => (answer.status === 'fulfilled' ? [[ids[index], answer.value]] : [])),
    )
  }
}

/** Every listed task's scripts in one read, for a list such as the rail's rows. Each task's entry also
 *  lands under its own key, so `cachedTaskScripts` answers for any task the list has shown. A task
 *  that's gone, or that the caller may not see, is absent from the map. */
export function createTaskScriptsBatch(taskIds: () => readonly string[]) {
  const queryClient = useQueryClient()
  const query = createQuery(() => {
    const ids = [...new Set(taskIds())].sort()
    return {
      queryKey: [...taskScriptsKey, { ids }],
      queryFn: async ({ signal }) => {
        const chunks: string[][] = []
        for (let at = 0; at < ids.length; at += TASK_IDS_PER_READ) chunks.push(ids.slice(at, at + TASK_IDS_PER_READ))
        const answers = await Promise.all(chunks.map((chunk) => readTaskScriptsBatch(chunk, signal)))
        const statuses = taskScriptsBatchSchema.parse(Object.assign({}, ...answers))
        for (const [id, status] of Object.entries(statuses)) queryClient.setQueryData([...taskScriptsKey, id], status)
        return statuses
      },
      enabled: ids.length > 0,
      refetchInterval: 15_000,
      staleTime: 20_000,
      // Each task's own entry persists already, and this would be a second copy of the lot.
      meta: { persist: false },
    }
  })
  const freshness = () => freshnessOf(nodeState(activeNodeId() ?? ''), query)
  return { query, freshness }
}

/** The status this window last read for a task, without reading again. For a synchronous gate such as
 *  a palette command's `when`. Undefined until something on screen has read the task's scripts. */
export const cachedTaskScripts = (taskId: string): TaskScriptsStatus | undefined =>
  clientFor(activeCacheId()).client.getQueryData<TaskScriptsStatus>([...taskScriptsKey, taskId])
export function scriptLabel(snapshot: TaskScriptSnapshot, now = Date.now()): string {
  const phase = snapshot.phase === 'setup' ? 'Setup' : 'Teardown'
  const elapsed =
    snapshot.startedAt === null
      ? ''
      : ` · ${Math.max(0, Math.floor(((snapshot.finishedAt ?? now) - snapshot.startedAt) / 1000))}s`
  if (snapshot.state === 'failed')
    return `${phase} failed (${snapshot.exitCode === null ? snapshot.reason.replaceAll('_', ' ') : `exit ${snapshot.exitCode}`})${elapsed}`
  if (snapshot.state === 'skipped' || snapshot.state === 'interrupted')
    return `${phase} ${snapshot.state} (${snapshot.reason.replaceAll('_', ' ')})`
  return `${phase} ${snapshot.state.replaceAll('_', ' ')}${elapsed}`
}
