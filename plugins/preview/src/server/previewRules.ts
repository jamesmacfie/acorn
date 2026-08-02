import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import type { PreviewBrowserRule } from '@acorn/protocol/serviceProtocol.ts'
import { getRepoPath } from '@acorn/node-core/main/repoPaths.ts'
import { loadTask } from '@acorn/node-core/main/taskWorktree.ts'

// Database lookup remains service-owned. Only serialisable rules cross into Electron main; the
// native preview never receives a database handle or reaches back into service modules.
export async function previewRulesForTask(db: AppDatabase, taskId: string): Promise<PreviewBrowserRule[]> {
  const task = await loadTask(db, taskId)
  if (!task) return []
  const repo = await getRepoPath(db, task.repoOwner, task.repoName)
  return repo?.browserRules ?? []
}
