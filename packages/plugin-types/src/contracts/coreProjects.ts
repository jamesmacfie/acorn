export type ProjectRef = {
  id: string
  name: string
  path: string | null
  workspaceId: string
  github: { owner: string; name: string; repoId: number | null } | null
}

export type ProjectCreateRefInput = {
  name: string
  path?: string | null
  workspaceId?: string
  github?: { owner: string; name: string; repoId?: number | null }
}

export type ProjectUpdateRefInput = {
  path?: string | null
  githubRepoId?: number | null
}

export type SetupTrigger = 'off' | 'created' | 'terminal'
export type PreviewMode = 'url' | 'port' | 'script'
export type DbSchemaMode = 'auto' | 'script' | 'file'
export type BrowserRule = {
  id: string
  enabled: boolean
  urlPattern: string
  trigger: 'load'
  action: { type: 'fill'; selector: string; value: string }
}
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
  browserRules: BrowserRule[]
  branchPrefix: string | null
}
export type ProjectConfigResponse = { projectId: string; config: ProjectConfig }

export type CoreProjectService = {
  byId(id: string): Promise<ProjectRef | null>
  byGithub(owner: string, name: string): Promise<ProjectRef | null>
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
  assertConfigTrusted(taskId: string): Promise<void>
  setup(id: string): Promise<{ script: string | null; trigger: SetupTrigger }>
}
