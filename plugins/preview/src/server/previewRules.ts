import type { PreviewBrowserRule } from '@acorn/protocol/serviceProtocol.ts'
import type { CoreServices } from '@acorn/node-core/main/core/index.ts'

// Database lookup remains service-owned. Only serialisable rules cross into Electron main; the
// native preview never receives a database handle or reaches back into service modules.
//
// Both tables this needs — `tasks` and `repo_paths` — are core-owned, so it goes through CoreServices
// rather than holding a database handle. The plugin dereferences a plain task ID through that seam.
export async function previewRulesForTask(
  core: Pick<CoreServices, 'tasks' | 'repos'>,
  taskId: string,
): Promise<PreviewBrowserRule[]> {
  const task = await core.tasks.load(taskId)
  if (!task) return []
  const repo = await core.repos.path(task.repoOwner, task.repoName)
  return repo?.browserRules ?? []
}
