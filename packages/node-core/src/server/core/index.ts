import { setupCheckoutActivity, taskScriptEvidence, type TaskScriptEvidenceService } from '../taskScripts/service'
import { schema, type AppDatabase } from '../db'
import { TASK_REF_COLUMNS } from '../worktrees/taskWorktree'
import type { ActiveIdentityStore } from '../activeIdentity'
import { createContextService, type ContextService } from './context'
import { createDataSourceService, type DataSourceService } from './data'
import * as fs from './fs'
import * as git from './git'
import { createIdentityService, type IdentityService } from './identity'
import { createModelService, type ModelService, type PluginGenerateTextRequest } from './models'
import { createPrefService, type PrefService } from './prefs'
import * as proc from './proc'
import { SecretService } from './secrets'
import { createTaskService, type CompiledTaskService, type TaskService } from './tasks'
import { createProjectService, type CompiledProjectService, type ProjectService } from './projectRefs'
import { createTelemetryService, type TelemetryService } from './telemetry'
import { verifyAgentToolProvenance } from '../agentTools/provenance'
import type { SecretPublicationGate } from '../secretChecks/gate'
import { createCheckoutAdmission, registerCheckoutAdmission, type CheckoutAdmission } from './checkoutAdmission'
import { getProject } from '../projects'
import type { CapabilityRegistry } from '../pluginHost/capabilities'
import type { NodeKeyCustody } from '../sessionKey'
import { realpathSync } from 'node:fs'

// The three module-shaped facets, named rather than left as `typeof <module>`.
//
// `typeof fs` meant the plugin API, and the `fs` permission grant, widened by whatever anyone happened
// to export from the module next — with no line in the surface snapshot and no review. Named here, an
// added export reaches plugins only when someone adds it below too. The declarations are held to the
// modules by the `satisfies` assertions in createCoreServices.
export type CoreFsService = {
  isContainedPath: typeof fs.isContainedPath
  isValidRepoIdent: typeof fs.isValidRepoIdent
  resolveInRoot: typeof fs.resolveInRoot
  confineExistingFile: typeof fs.confineExistingFile
}

export type CoreGitService = {
  GIT_MAX_OUTPUT_BYTES: typeof git.GIT_MAX_OUTPUT_BYTES
  GIT_TIMEOUT_MS: typeof git.GIT_TIMEOUT_MS
  git: typeof git.git
  gitOrThrow: typeof git.gitOrThrow
  gitText: typeof git.gitText
}

export type CoreProcService = {
  DEFAULT_MAX_OUTPUT_BYTES: typeof proc.DEFAULT_MAX_OUTPUT_BYTES
  DEFAULT_TIMEOUT_MS: typeof proc.DEFAULT_TIMEOUT_MS
  KILL_GRACE_MS: typeof proc.KILL_GRACE_MS
  brokerEnv: typeof proc.brokerEnv
  runProcess: typeof proc.runProcess
  runProcessOrThrow: typeof proc.runProcessOrThrow
  ProcessError: typeof proc.ProcessError
}

export type CoreServices = {
  /** Verify provenance that the authenticated tool route minted for one signed invocation. */
  agentToolProvenance?: {
    verify(input: import('../agentTools/provenance').AgentToolProvenance): boolean | Promise<boolean>
  }
  // Path confinement for anything a caller names: worktree-relative reads/writes, agent file mentions.
  fs: CoreFsService
  // The one git seam: GIT_TERMINAL_PROMPT=0, SSH_AUTH_SOCK passthrough, bounded output.
  git: CoreGitService
  // Every child process: env allowlist, process-group kill, bounded capture.
  proc: CoreProcService
  // Use-scoped credential access; scrubs the plaintext out of anything thrown from its scope.
  secrets: SecretService
  // Resolve a taskId against core-owned task tables for callers that hold only a task reference. What
  // comes back is a TaskRef projection, never the `tasks` row and never the core SQLite handle.
  tasks: TaskService
  // The launch-context reads (the injection pref + core's section assembler), for the plugin that
  // pushes a first prompt into a new agent session.
  context: ContextService
  // Text generation through a stored model-provider connection. The plugin owns the prompt; core owns
  // credential resolution and the provider adapters.
  models: ModelService
  // Host-mediated database access. Core owns URL resolution, credentials, the driver, pools and
  // enforcement; a plugin receives only the permission-scoped methods in this service.
  data: DataSourceService
  // One (userId, key) row of core's `prefs` table. The server-side half of a preference the node
  // itself has to read, such as plugins/agents' model-pricing overrides, which the usage service
  // needs before it can price a token count.
  prefs: PrefService
  // The machine identity: which owner this node is bound to. Read-only for consumers. The binding is
  // minted at boot by ensureBoundIdentity in server/bindings.ts, never by a plugin.
  identity: IdentityService
  // Narrow project identity for plugins: scope resolution, importer writes, and all mapped project
  // folders. The returned ProjectRef never exposes core config or the core SQLite handle.
  projects: ProjectService
  // Read this node's telemetry stream. The only read-everything facet on this object, which is why
  // its token draws high in the trust prompt (./telemetry.ts, docs/telemetry/plugins-and-sinks.md § Writing a sink).
  telemetry: TelemetryService
}

/** First-party orchestration seams that never cross the loaded-plugin boundary. */
export type CompiledCoreServices = Omit<CoreServices, 'tasks' | 'projects' | 'models'> & {
  /** Registered names and risk tiers for diagnostics, bounded by owner preferences and session policy. */
  agentTools?: { catalog(): Promise<Array<{ name: string; risk: import('@acorn/protocol/api.ts').ToolRisk }>> }
  /** Bounded passive plugin facts, read from the plugin state bridge when called. */
  pluginSecurity: { snapshot(): Promise<import('../pluginHost/pluginSecurity').PluginSecuritySnapshot> }
  /** Where this Node's keys came from and whether plain copies remain. */
  nodeKeys: { snapshot(): NodeKeyCustody }
  /** The optional secret publication gate. Loaded plugins receive no grant for it. */
  secretPublication?: SecretPublicationGate
  checkoutAdmission: CheckoutAdmission
  /** Serializes repository metadata writes with task branch reservations for the same Git object store. */
  repositoryMetadata: {
    write<T>(projectId: string, action: (repository: string, commonDirectory: string) => Promise<T>): Promise<T>
  }
  taskScripts: TaskScriptEvidenceService
  tasks: CompiledTaskService
  projects: CompiledProjectService
  // `forPlugin` is the owner-bound facet scopeCore hands a loaded plugin (../modelProviders/grants.ts).
  models: ModelService & {
    forPlugin(pluginId: string): {
      generateText(request: PluginGenerateTextRequest): ReturnType<ModelService['generateText']>
      available: ModelService['available']
    }
  }
}

export function createCoreServices(options: {
  secrets: SecretService
  db: AppDatabase
  // The persisted binding. Required rather than defaulted, so a composition root cannot end up with
  // a process-local identity by omission. Tests pass memoryIdentityStore() from server/activeIdentity.ts.
  activeIdentity: ActiveIdentityStore
  // From the session key check, which runs before core services are built.
  nodeKeys: { snapshot(): NodeKeyCustody }
  // The boot's capability registry. Core reads the plugin state bridge from it at call time, because
  // the bridge only exists once the plugins have started.
  capabilities: CapabilityRegistry
}): CompiledCoreServices {
  const rawTasks = createTaskService(options.db)
  const projects = createProjectService(options.db, options.activeIdentity)
  const checkoutAdmission = createCheckoutAdmission(rawTasks, projects, git, async () =>
    options.db.select(TASK_REF_COLUMNS).from(schema.tasks).all(),
  )
  checkoutAdmission.registerOwner('setup', async (taskIds) => setupCheckoutActivity(options.db, taskIds))
  registerCheckoutAdmission(options.db, checkoutAdmission)
  const tasks: CompiledTaskService = {
    ...rawTasks,
    root: (taskId) => checkoutAdmission.admitWork(taskId, () => rawTasks.root(taskId)),
    requireRoot: (taskId) => checkoutAdmission.admitWork(taskId, () => rawTasks.requireRoot(taskId)),
    resolveCwd: (task, baseCheckout) =>
      task
        ? checkoutAdmission.admitWork(task.id, () => rawTasks.resolveCwd(task, baseCheckout))
        : rawTasks.resolveCwd(task, baseCheckout),
    runConfig: (taskId) => checkoutAdmission.admitWork(taskId, () => rawTasks.runConfig(taskId)),
  }
  const identity = createIdentityService(options.activeIdentity)
  const models = createModelService(options.db, options.secrets)
  const prefs = createPrefService(options.db)
  let gate: Promise<SecretPublicationGate> | undefined
  const secretGate = () =>
    (gate ??= import('../secretChecks/gate').then((module) =>
      module.createSecretPublicationGate({ db: options.db, prefs, identity }),
    ))
  return {
    agentToolProvenance: { verify: verifyAgentToolProvenance },
    agentTools: {
      catalog: async () =>
        (await import('../agentTools/registry')).agentToolContributions().map(({ name, risk }) => ({ name, risk })),
    },
    // `satisfies`, not a bare reference: it is what makes the named facets above a projection of the
    // real modules rather than a second declaration that can drift off them.
    fs: fs satisfies CoreFsService,
    git: git satisfies CoreGitService,
    checkoutAdmission,
    repositoryMetadata: {
      write: async (projectId, action) => {
        const { repositoryMetadataKey, withBranchReservation } = await import('../worktrees/taskBranch')
        const project = await getProject(options.db, projectId)
        if (!project?.path || project.vcs !== 'git') throw new Error('Git project is unavailable on this Node.')
        return withBranchReservation(options.db, project, async () =>
          action(
            realpathSync(
              await git.gitText(['rev-parse', '--show-toplevel'], { cwd: project.path!, timeoutMs: 10_000 }),
            ),
            await repositoryMetadataKey(project),
          ),
        )
      },
    },
    proc: proc satisfies CoreProcService,
    secrets: options.secrets,
    tasks,
    taskScripts: taskScriptEvidence(options.db, (taskId, action) => checkoutAdmission.admitWork(taskId, action)),
    context: createContextService(options.db),
    models: {
      ...models,
      // The grant runtime loads on a loaded plugin's first call, not at boot.
      forPlugin: (pluginId) => ({
        generateText: async (request) =>
          (await import('../modelProviders/grants'))
            .pluginModelService(options.db, models, identity, pluginId)
            .generateText(request),
        available: (userId) => models.available(userId),
      }),
    },
    data: createDataSourceService({ tasks, projects, fs, proc }),
    prefs,
    // Loaded on first use, so a node that never commits, pushes, exports, or sends an attachment
    // carries none of the gate's code.
    secretPublication: {
      enabled: async () => (await secretGate()).enabled(),
      admit: async (input) => (await secretGate()).admit(input),
    },
    identity,
    projects,
    telemetry: createTelemetryService(),
    nodeKeys: options.nodeKeys,
    // Loaded on first use, so the snapshot's code stays out of the boot graph.
    pluginSecurity: {
      snapshot: async () => {
        const { PLUGIN_STATE } = await import('../pluginHost/state')
        const { pluginSecuritySnapshot } = await import('../pluginHost/pluginSecurity')
        return pluginSecuritySnapshot(options.capabilities.require(PLUGIN_STATE))
      },
    },
  }
}

export { SecretService }
export type {
  AttachTaskPullInput,
  ChildTaskSeed,
  CompiledTaskService,
  RootTaskSeed,
  TaskLinkRef,
  TaskPullRelation,
  TaskRunConfig,
  TaskService,
} from './tasks'
export type { IdentityService } from './identity'
export type { CompiledProjectService, ProjectService } from './projectRefs'
// The shapes ProjectService hands back and takes in. A plugin that calls the seam has to name them,
// and they carry no core config columns and no database handle.
export type { ProjectCreateRefInput, ProjectRef, ProjectUpdateRefInput } from '../projects'
// The same arrangement one entity over: what TaskService hands back and takes in. Six fields off the
// `tasks` row, and no database handle.
export type { TaskRef } from '../worktrees/taskWorktree'
export type { ContextService } from './context'
export type { PrefService } from './prefs'
export type { TelemetryService, TelemetrySink } from './telemetry'
export type { GenerateTextRequest, ModelService, PluginGenerateTextRequest } from './models'
export type {
  DataCell,
  DataColumn,
  DataQueryOptions,
  DataQueryResult,
  DataSchemaResult,
  DataSchemaSource,
  DataSourceService,
  DataTable,
} from './data'
export { SecretUnavailableError, redact } from './secrets'
export type { ProcResult, ProcSpec } from './proc'
export type { ConfineFailure, ConfineResult } from './fs'
