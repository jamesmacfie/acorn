// Agents in an untrusted project (docs/workspaces-and-tasks/projects.md § Untrusted projects). Loaded
// on first use, to stay inside the service boot budget (apps/node/scripts/check-service-budget.mjs).
import {
  UNTRUSTED_REPOSITORY_PROMPT,
  untrustedHarnessRefusal,
  untrustedLaunchArgs,
  type AgentProfileContribution,
  type CoreServices,
} from '@acorn/plugin-api/node'
import type { AgentDriver } from './drivers/types'

/** The line a locked-down managed session's instructions start with. Throws for a driver that can't
 *  lock down. */
export function lockedDownInstructions(driver: Pick<AgentDriver, 'untrusted'>): string {
  if (!driver.untrusted) throw untrustedHarnessRefusal()
  return UNTRUSTED_REPOSITORY_PROMPT
}

/** Whether the task's project is untrusted, read at each start so a trust change applies from the next. */
export async function taskProjectUntrusted(core: Pick<CoreServices, 'tasks' | 'projects'>, taskId: string) {
  const task = await core.tasks.load(taskId)
  return !!task && (await core.projects.byId(task.projectId))?.trusted === false
}

/** A terminal handoff's argv after the command, with the profile's lock-down flags in front in an
 *  untrusted project. Throws for a profile that can't lock down. */
export async function handoffArgs(
  core: Pick<CoreServices, 'tasks' | 'projects'>,
  taskId: string,
  profile: AgentProfileContribution,
  args: string[],
): Promise<string[]> {
  return (await taskProjectUntrusted(core, taskId)) ? untrustedLaunchArgs(profile, args) : args
}
