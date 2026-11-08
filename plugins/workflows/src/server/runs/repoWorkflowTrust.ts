// Committed workflows in an untrusted project (docs/workspaces-and-tasks/projects.md § Untrusted
// projects). Loaded on first use, to stay inside the service boot budget
// (apps/node/scripts/check-service-budget.mjs).
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CoreServices } from '@acorn/plugin-api/node'
import { loadWorkflowFiles } from '../definitions/files'
import type { WorkflowValidationCatalog } from '../validation/definition'
import { WorkflowAuthorityError } from './authority'

const UNTRUSTED_REPO_WORKFLOWS =
  "This project is untrusted, so its committed workflows can't run. Trust the project to run them."

/** Committed workflows never run in an untrusted project, whatever its configuration review says. */
function refuseUntrustedProject(project: { trusted?: boolean } | null | undefined): void {
  if (project?.trusted === false) throw new WorkflowAuthorityError('untrusted', UNTRUSTED_REPO_WORKFLOWS)
}

export async function authorizeTaskWorkflow(
  core: Pick<CoreServices, 'tasks' | 'projects'>,
  taskId: string,
): Promise<void> {
  const task = await core.tasks.load(taskId)
  refuseUntrustedProject(task && (await core.projects.byId(task.projectId)))
  await core.projects.assertConfigTrusted(taskId)
}

/** The same check for a project, before a trigger starts a run in it. */
export async function authorizeProjectWorkflow(
  core: Pick<CoreServices, 'projects'> & { projects: { assertProjectConfigTrusted(id: string): Promise<void> } },
  projectId: string,
): Promise<void> {
  refuseUntrustedProject(await core.projects.byId(projectId))
  await core.projects.assertProjectConfigTrusted(projectId)
}

/** An untrusted task's workflow list: the owner's own files, and one row saying why the checkout's
 *  committed ones are missing, which a start would refuse anyway. */
export function untrustedWorkflowFiles(repoDir: string | null, catalog: WorkflowValidationCatalog) {
  const files = loadWorkflowFiles(null, homedir(), catalog)
  if (repoDir && existsSync(join(repoDir, '.acorn', 'workflows')))
    files.errors.push({ source: 'repo', message: UNTRUSTED_REPO_WORKFLOWS })
  return files
}
