/** A project's Git remote: the host and path, both lowercased, and the id of the code host plugin that
 *  claims the host, or null when none does. `externalId` is that provider's own id for the repository. */
export type ProjectRepository = { provider: string | null; host: string; path: string; externalId: string | null }

export type ProjectRef = {
  id: string
  name: string
  path: string | null
  workspaceId: string
  repository: ProjectRepository | null
  /** `repository` read as GitHub's owner and name, for a `github.com` remote only. */
  github: { owner: string; name: string; repoId: number | null } | null
}

export type ProjectCreateRefInput = {
  name: string
  path?: string | null
  workspaceId?: string
  /** The provider is whichever code host claims `host`. */
  repository?: { host: string; path: string; externalId?: string | null }
  /** The same as `repository` on `github.com`, with `repoId` as the external id. */
  github?: { owner: string; name: string; repoId?: number | null }
}

export type ProjectUpdateRefInput = {
  path?: string | null
  repositoryExternalId?: string | null
  /** The same as `repositoryExternalId`, as a number. */
  githubRepoId?: number | null
}

export type SetupTrigger = 'off' | 'created' | 'terminal'
export type PreviewMode = 'url' | 'port' | 'script'
export type DbSchemaMode = 'auto' | 'script' | 'file'
export type ProjectConfig = {
  runTargets: string | null
  editorCommand: string | null
  setupScript: string | null
  setupScriptTrigger: SetupTrigger | null
  devScript: string | null
  devRestartScript: string | null
  teardownScript: string | null
  dbUrlScript: string | null
  dbSchemaMode: DbSchemaMode | null
  dbSchemaValue: string | null
  dbSchemaNotes: string | null
  previewMode: PreviewMode | null
  previewValue: string | null
  branchPrefix: string | null
}
export type ProjectConfigResponse = { projectId: string; config: ProjectConfig }

export type CoreProjectService = {
  byId(id: string): Promise<ProjectRef | null>
  byGithub(owner: string, name: string): Promise<ProjectRef | null>
  /** The project whose remote is `path` on a host `provider` claims. Two clones of one repository are
   *  two projects, and the oldest wins, as with `byGithub`. */
  byRepository(provider: string, path: string): Promise<ProjectRef | null>
  checkouts(): Promise<{ id: string; path: string }[]>
  /** Every project of one workspace, keeping the ones with no folder on disk. Not granted by
   *  `projects:read` today: no loaded plugin has asked for it. */
  byWorkspace(workspaceId: string): Promise<ProjectRef[]>
  /** Scoped to the provider ids the host registered for your plugin, so another provider's connection
   *  never crosses this boundary. `projectId` is `''` when the link covers the whole workspace. */
  externalProjects(
    workspaceId: string,
    providerIds?: readonly string[],
  ): Promise<Array<{ connectionId: string; externalId: string; projectId: string }>>
  create(input: ProjectCreateRefInput): Promise<ProjectRef>
  update(id: string, patch: ProjectUpdateRefInput): Promise<ProjectRef | null>
  /** The project's build, dev and database scripts: commands acorn executes, behind their own grant. */
  config(id: string): Promise<ProjectConfigResponse | null>
  /** An expected hash binds execution to the selected configuration snapshot; drift is refused. */
  assertConfigTrusted(taskId: string, expectedHash?: string): Promise<void>
  setup(id: string): Promise<{ script: string | null; trigger: SetupTrigger }>
}
