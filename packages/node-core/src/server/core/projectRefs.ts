import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import {
  createProjectRef,
  getProject,
  projectByGithub,
  projectByRepository,
  toProjectRef,
  updateProjectRef,
  type ProjectCreateRefInput,
  type ProjectRef,
  type ProjectUpdateRefInput,
} from '../projects/projects'
import type { ProjectConfig, ProjectConfigResponse } from '@acorn/protocol/api.ts'
import { getProjectConfig } from '../projects/projectConfig'
import { assertProjectRepoConfigTrusted, assertRepoConfigTrusted } from '../projects/repoConfigTrust'
import { projectSetup, type SetupTrigger } from '../worktrees/taskWorktree'
import type { ActiveIdentityStore } from '../activeIdentity'

// The project seam available to plugins. Identity and write methods accept or return narrow ProjectRef
// projections, so they never expose core's config columns or its SQLite handle. config() and setup()
// deliberately carry executable project configuration and are gated behind `projects:config` rather
// than the identity-level `projects:read` grant (server/plugins/permissions.ts).
export type ProjectService = {
  byId(id: string): Promise<ProjectRef | null>
  // Oldest project wins, matching projectByGithub. Callers that need every clone
  // use project checkouts and their own project-level IDs rather than guessing from the pair.
  byGithub(owner: string, name: string): Promise<ProjectRef | null>
  // The project whose remote is `path` on a host `provider` claims. Oldest wins, the same rule as
  // byGithub, so two clones of one repository resolve the same way through either.
  byRepository(provider: string, path: string): Promise<ProjectRef | null>
  checkouts(): Promise<{ id: string; path: string }[]>
  // Every project of one workspace, in the rail's order. Unlike `checkouts()` this keeps a project
  // with no folder on disk, because a caller deciding what a workspace contains has to be able to
  // tell "no checkout" from "no project" (plugins/workflows' merged definition list).
  byWorkspace(workspaceId: string): Promise<ProjectRef[]>
  // Provider project mappings belong to core's workspace model. Core callers may omit providerIds;
  // loaded plugins are wrapped with the provider ids the host registered for their plugin owner, so
  // another provider's connection and external id never cross the CoreServices boundary.
  // `projectId` is '' when the link covers the whole workspace, and a project id when it covers only
  // that one project. A caller drawing a project-scoped surface keeps the rows that match either.
  externalProjects(
    workspaceId: string,
    providerIds?: readonly string[],
  ): Promise<Array<{ connectionId: string; externalId: string; projectId: string }>>
  create(input: ProjectCreateRefInput): Promise<ProjectRef>
  // A loaded plugin's calls pass its id as `holder` (server/plugins/permissions.ts), so it can't set an
  // external id on a repository another code host holds.
  update(id: string, patch: ProjectUpdateRefInput, holder?: string): Promise<ProjectRef | null>
  // Without site associations: they only steer the browser extension's suggestions, so they stay out of
  // the plugin contract.
  config(id: string): Promise<PluginProjectConfigResponse | null>
  /** An expected hash binds execution to the selected configuration snapshot; drift is refused. */
  assertConfigTrusted(taskId: string, expectedHash?: string): Promise<void>
  setup(id: string): Promise<{ script: string | null; trigger: SetupTrigger }>
}

type PluginProjectConfigResponse = Omit<ProjectConfigResponse, 'config'> & {
  config: Omit<ProjectConfig, 'siteAssociations'>
}

export type CompiledProjectService = ProjectService & {
  assertProjectConfigTrusted(projectId: string): Promise<void>
}

export function createProjectService(db: AppDatabase, activeIdentity: ActiveIdentityStore): CompiledProjectService {
  return {
    byId: async (id) => {
      const row = await getProject(db, id)
      return row ? toProjectRef(row) : null
    },
    byGithub: async (owner, name) => {
      const row = await projectByGithub(db, owner, name)
      return row ? toProjectRef(row) : null
    },
    byRepository: async (provider, path) => {
      const row = await projectByRepository(db, provider, path)
      return row ? toProjectRef(row) : null
    },
    byWorkspace: async (workspaceId) =>
      db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.workspaceId, workspaceId))
        .orderBy(asc(schema.projects.sort), asc(schema.projects.createdAt))
        .then((rows) => rows.map(toProjectRef)),
    checkouts: async () =>
      db
        .select({ id: schema.projects.id, path: schema.projects.path })
        .from(schema.projects)
        .where(isNotNull(schema.projects.path))
        .orderBy(asc(schema.projects.createdAt), asc(schema.projects.id))
        .then((rows) => rows.flatMap((row) => (row.path ? [{ id: row.id, path: row.path }] : []))),
    externalProjects: (workspaceId, providerIds) => {
      // An empty owner set must stay empty. In particular, it must not be interpreted as the optional
      // "all providers" form used by core-owned callers.
      if (providerIds?.length === 0) return Promise.resolve([])
      return db
        .select({
          connectionId: schema.workspaceExternalProjects.integrationId,
          externalId: schema.workspaceExternalProjects.externalId,
          projectId: schema.workspaceExternalProjects.projectId,
        })
        .from(schema.workspaceExternalProjects)
        .innerJoin(schema.integrations, eq(schema.integrations.id, schema.workspaceExternalProjects.integrationId))
        .where(
          and(
            eq(schema.workspaceExternalProjects.workspaceId, workspaceId),
            providerIds ? inArray(schema.integrations.provider, [...providerIds]) : undefined,
          ),
        )
        .orderBy(asc(schema.workspaceExternalProjects.integrationId), asc(schema.workspaceExternalProjects.externalId))
    },
    create: (input) => createProjectRef(db, input, activeIdentity.get() ?? ''),
    update: (id, patch, holder) => updateProjectRef(db, id, patch, holder),
    config: async (id) => {
      const response = await getProjectConfig(db, id)
      if (!response) return null
      const { siteAssociations: _siteAssociations, ...config } = response.config
      return { ...response, config }
    },
    assertConfigTrusted: (taskId, expectedHash) => assertRepoConfigTrusted(db, taskId, expectedHash),
    assertProjectConfigTrusted: (projectId) => assertProjectRepoConfigTrusted(db, projectId),
    setup: (id) => projectSetup(db, id),
  }
}
