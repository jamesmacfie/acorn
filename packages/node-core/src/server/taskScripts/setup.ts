import type { AppDatabase } from '../db'
import { getProject } from '../projects'
import { getProjectConfig } from '../projectConfig'
import { taskScripts } from './service'

/** Record intentional non-execution when a task cycle begins; a configured lazy setup stays unrequested. */
export async function recordSetupDecision(db: AppDatabase, taskId: string, publish = true): Promise<void> {
  const scripts = taskScripts(db)
  const task = scripts.store.task(taskId)
  if (!task.scriptHistoryKnown || task.worktreePath || scripts.select(taskId, 'setup').attemptId) return
  const project = await getProject(db, task.projectId)
  const config = project ? await getProjectConfig(db, project.id) : null
  const skip = !task.branch || project?.vcs !== 'git' ? 'not_applicable'
    : task.skipSetup ? 'user_skipped' : config?.config.setupScriptTrigger === 'off' ? 'disabled'
    : !config?.config.setupScript?.trim() ? 'not_configured' : undefined
  // Config reads yield. A creator may have admitted setup or advanced the cycle meanwhile.
  if (skip && scripts.store.task(taskId).scriptGeneration === task.scriptGeneration && !scripts.select(taskId, 'setup').attemptId) scripts.admit(taskId, 'setup', skip, publish)
}
