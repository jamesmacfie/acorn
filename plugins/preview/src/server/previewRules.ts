import type { PreviewBrowserRule } from '@acorn/protocol/serviceProtocol.ts'
import type { CoreServices } from '@acorn/plugin-api/node'

// Database lookup remains service-owned. Only serialisable rules cross into Electron main; the
// native preview never receives a database handle or reaches back into service modules.
//
// Both tables this needs — `tasks` and `projects` — are core-owned, so it goes through CoreServices
// rather than holding a database handle. The plugin dereferences a plain task ID through that seam.
export async function previewRulesForTask(
  core: Pick<CoreServices, 'tasks' | 'projects'>,
  taskId: string,
): Promise<PreviewBrowserRule[]> {
  const task = await core.tasks.load(taskId)
  if (!task) return []
  if (!task.projectId) return []
  const project = await core.projects.config(task.projectId)
  return project?.config.browserRules ?? []
}
