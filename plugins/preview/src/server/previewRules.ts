import type { PreviewBrowserRule } from '@acorn/protocol/serviceProtocol.ts'
import type { CoreServices } from '@acorn/node-core/main/core/index.ts'

// Database lookup remains service-owned. Only serialisable rules cross into Electron main; the
// native preview never receives a database handle or reaches back into service modules.
//
// Both tables this needs — `tasks` and `repo_paths` — are CORE's, so it goes through CoreServices rather
// than holding a handle. It previously took core's `AppDatabase` and called `loadTask`/`getRepoPath`
// directly, which is the coupling the per-plugin database split removes: a plugin dereferences a plain id
// through the owning package (docs/vNext/data.md § Plugin DBs). This plugin owns no tables of its own, so
// it has no handle it could have used instead.
export async function previewRulesForTask(
  core: Pick<CoreServices, 'tasks' | 'repos'>,
  taskId: string,
): Promise<PreviewBrowserRule[]> {
  const task = await core.tasks.load(taskId)
  if (!task) return []
  const repo = await core.repos.path(task.repoOwner, task.repoName)
  return repo?.browserRules ?? []
}
