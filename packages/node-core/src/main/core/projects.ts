import { asc, isNotNull } from 'drizzle-orm'
import type { AppDatabase } from '../../server/db'
import { schema } from '../../server/db'
import { createProjectRef, getProject, projectByGithub, toProjectRef, updateProjectRef, type ProjectCreateRefInput, type ProjectRef, type ProjectUpdateRefInput } from '../projects'
import type { ProjectConfigResponse } from '@acorn/protocol/api.ts'
import { getProjectConfig } from '../projectConfig'
import { assertRepoConfigTrusted } from '../repoConfigTrust'
import { projectSetup, type SetupTrigger } from '../taskWorktree'

// The project identity seam available to plugins. Every method returns a projection so plugins cannot
// learn core's config columns or accidentally join/attach the core SQLite file.
export type ProjectService = {
  byId(id: string): Promise<ProjectRef | null>
  // Oldest project wins, matching projectByGithub's legacy-pair bridge. Callers that need every clone
  // use project checkouts and their own project-level IDs rather than guessing from the pair.
  byGithub(owner: string, name: string): Promise<ProjectRef | null>
  checkouts(): Promise<{ id: string; path: string }[]>
  create(input: ProjectCreateRefInput): Promise<ProjectRef>
  update(id: string, patch: ProjectUpdateRefInput): Promise<ProjectRef | null>
  config(id: string): Promise<ProjectConfigResponse | null>
  assertConfigTrusted(taskId: string): Promise<void>
  setup(id: string): Promise<{ script: string | null; trigger: SetupTrigger }>
}

export function createProjectService(db: AppDatabase): ProjectService {
  return {
    byId: async (id) => {
      const row = await getProject(db, id)
      return row ? toProjectRef(row) : null
    },
    byGithub: async (owner, name) => {
      const row = await projectByGithub(db, owner, name)
      return row ? toProjectRef(row) : null
    },
    checkouts: async () => db
      .select({ id: schema.projects.id, path: schema.projects.path })
      .from(schema.projects)
      .where(isNotNull(schema.projects.path))
      .orderBy(asc(schema.projects.createdAt), asc(schema.projects.id))
      .then((rows) => rows.flatMap((row) => row.path ? [{ id: row.id, path: row.path }] : [])),
    create: (input) => createProjectRef(db, input),
    update: (id, patch) => updateProjectRef(db, id, patch),
    config: (id) => getProjectConfig(db, id),
    assertConfigTrusted: (taskId) => assertRepoConfigTrusted(db, taskId),
    setup: (id) => projectSetup(db, id),
  }
}
