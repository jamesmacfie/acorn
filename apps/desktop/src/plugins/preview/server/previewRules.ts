import type { AppDatabase } from '../../../core/server/db'
import type { PreviewBrowserRule } from '@acorn/protocol/serviceProtocol.ts'
import { getRepoPath } from '../../../core/main/repoPaths'
import { loadTask } from '../../../core/main/taskWorktree'

// Database lookup remains service-owned. Only serialisable rules cross into Electron main; the
// native preview never receives a database handle or reaches back into service modules.
export async function previewRulesForTask(db: AppDatabase, taskId: string): Promise<PreviewBrowserRule[]> {
  const task = await loadTask(db, taskId)
  if (!task) return []
  const repo = await getRepoPath(db, task.repoOwner, task.repoName)
  return repo?.browserRules ?? []
}
