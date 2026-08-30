import type { AppDatabase } from '../db'
import type { ActiveIdentityStore } from '../activeIdentity'
import { createContextService, type ContextService } from './context'
import * as fs from './fs'
import * as git from './git'
import { createIdentityService, type IdentityService } from './identity'
import { createModelService, type ModelService } from './models'
import { createPrefService, type PrefService } from './prefs'
import * as proc from './proc'
import { SecretService } from './secrets'
import { createTaskService, type TaskService } from './tasks'
import { createProjectService, type ProjectService } from './projectRefs'

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
}

export function createCoreServices(options: {
  secrets: SecretService
  db: AppDatabase
  // The persisted binding. Required rather than defaulted, so a composition root cannot end up with
  // a process-local identity by omission. Tests pass memoryIdentityStore() from server/activeIdentity.ts.
  activeIdentity: ActiveIdentityStore
}): CoreServices {
  return {
    // `satisfies`, not a bare reference: it is what makes the named facets above a projection of the
    // real modules rather than a second declaration that can drift off them.
    fs: fs satisfies CoreFsService,
    git: git satisfies CoreGitService,
    proc: proc satisfies CoreProcService,
    secrets: options.secrets,
    tasks: createTaskService(options.db),
    context: createContextService(options.db),
    models: createModelService(options.db, options.secrets),
    prefs: createPrefService(options.db),
    identity: createIdentityService(options.activeIdentity),
    projects: createProjectService(options.db),
  }
}

export { SecretService }
export type { AttachTaskPullInput, ChildTaskSeed, TaskLinkRef, TaskPullRelation, TaskRunConfig, TaskService } from './tasks'
export type { IdentityService } from './identity'
export type { ProjectService } from './projectRefs'
// The shapes ProjectService hands back and takes in. A plugin that calls the seam has to name them,
// and they carry no core config columns and no database handle.
export type { ProjectCreateRefInput, ProjectRef, ProjectUpdateRefInput } from '../projects'
// The same arrangement one entity over: what TaskService hands back and takes in. Six fields off the
// `tasks` row, and no database handle.
export type { TaskRef } from '../worktrees/taskWorktree'
export type { ContextService } from './context'
export type { PrefService } from './prefs'
export type { GenerateTextRequest, ModelService } from './models'
export { SecretUnavailableError, redact } from './secrets'
export type { ProcResult, ProcSpec } from './proc'
export type { ConfineFailure, ConfineResult } from './fs'
