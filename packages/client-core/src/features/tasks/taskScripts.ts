import { createQuery } from '@tanstack/solid-query'
import { taskScriptsKey, taskScriptsRoute, taskScriptsStatusSchema, type TaskScriptSnapshot, type TaskScriptsStatus } from '@acorn/protocol/taskScripts.ts'
import { readJson } from '../../infra/node/apiClient'
import { activeCacheId, activeNodeId } from '../../infra/node/activeNode'
import { clientFor, nodeState } from '../../infra/node/fleet'
import { freshnessOf } from '../../infra/node/freshness'

export function createTaskScripts(taskId: () => string) {
  const query = createQuery(() => ({
    queryKey: [...taskScriptsKey, taskId()],
    queryFn: async ({ signal }) => taskScriptsStatusSchema.parse(await readJson(taskScriptsRoute(taskId()), { signal })),
    refetchInterval: 15_000,
    staleTime: 20_000,
  }))
  const freshness = () => freshnessOf(nodeState(activeNodeId() ?? ''), query)
  return { query, freshness }
}

/** The status this window last read for a task, without reading again. For a synchronous gate such as
 *  a palette command's `when`. Undefined until something on screen has read the task's scripts. */
export const cachedTaskScripts = (taskId: string): TaskScriptsStatus | undefined =>
  clientFor(activeCacheId()).client.getQueryData<TaskScriptsStatus>([...taskScriptsKey, taskId])
export function scriptLabel(snapshot: TaskScriptSnapshot, now = Date.now()): string {
  const phase = snapshot.phase === 'setup' ? 'Setup' : 'Teardown'
  const elapsed = snapshot.startedAt === null ? '' : ` · ${Math.max(0, Math.floor(((snapshot.finishedAt ?? now) - snapshot.startedAt) / 1000))}s`
  if (snapshot.state === 'failed') return `${phase} failed (${snapshot.exitCode === null ? snapshot.reason.replaceAll('_', ' ') : `exit ${snapshot.exitCode}`})${elapsed}`
  if (snapshot.state === 'skipped' || snapshot.state === 'interrupted') return `${phase} ${snapshot.state} (${snapshot.reason.replaceAll('_', ' ')})`
  return `${phase} ${snapshot.state.replaceAll('_', ' ')}${elapsed}`
}
