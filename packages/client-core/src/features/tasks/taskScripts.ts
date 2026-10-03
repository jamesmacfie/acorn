import { createQuery } from '@tanstack/solid-query'
import { taskScriptsKey, taskScriptsRoute, taskScriptsStatusSchema, type TaskScriptSnapshot } from '@acorn/protocol/taskScripts.ts'
import { readJson } from '../../infra/node/apiClient'
import { activeNodeId } from '../../infra/node/activeNode'
import { nodeState } from '../../infra/node/fleet'
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
export function scriptLabel(snapshot: TaskScriptSnapshot, now = Date.now()): string {
  const phase = snapshot.phase === 'setup' ? 'Setup' : 'Teardown'
  const elapsed = snapshot.startedAt === null ? '' : ` · ${Math.max(0, Math.floor(((snapshot.finishedAt ?? now) - snapshot.startedAt) / 1000))}s`
  if (snapshot.state === 'failed') return `${phase} failed (${snapshot.exitCode === null ? snapshot.reason.replaceAll('_', ' ') : `exit ${snapshot.exitCode}`})${elapsed}`
  if (snapshot.state === 'skipped' || snapshot.state === 'interrupted') return `${phase} ${snapshot.state} (${snapshot.reason.replaceAll('_', ' ')})`
  return `${phase} ${snapshot.state.replaceAll('_', ' ')}${elapsed}`
}
