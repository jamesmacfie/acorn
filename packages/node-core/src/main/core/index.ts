import type { AppDatabase } from '../../server/db'
import { createContextService, type ContextService } from './context'
import * as fs from './fs'
import * as git from './git'
import { createIdentityService, type IdentityService } from './identity'
import { createModelService, type ModelService } from './models'
import { createPrefService, type PrefService } from './prefs'
import * as proc from './proc'
import { createRepoService, type RepoService } from './repos'
import { SecretService } from './secrets'
import { createTaskService, type TaskService } from './tasks'

export type CoreServices = {
  // Path confinement for anything a caller names: worktree-relative reads/writes, agent file mentions.
  fs: typeof fs
  // The one git seam — GIT_TERMINAL_PROMPT=0, SSH_AUTH_SOCK passthrough, bounded output.
  git: typeof git
  // Every child process: env allowlist, process-group kill, bounded capture.
  proc: typeof proc
  // Use-scoped credential access; scrubs the plaintext out of anything thrown from its scope.
  secrets: SecretService
  // Resolve a taskId against core-owned task tables for callers that hold only a task reference.
  tasks: TaskService
  // The same seam for `repo_paths` + the executable-config trust gate: where a repo lives on this
  // machine, its per-repo settings, and whether its committed config has been acknowledged.
  repos: RepoService
  // The launch-context reads (the injection pref + core's section assembler), for the plugin that
  // pushes a first prompt into a new agent session.
  context: ContextService
  // Text generation through a stored model-provider connection. The plugin owns the prompt; core owns
  // credential resolution and the provider adapters.
  models: ModelService
  // One (userId, key) row of core's `prefs` table. The server-side half of a preference whose value
  // the node itself has to read — today only plugins/agents' model-pricing overrides, which the usage
  // service needs before it can price a token count.
  prefs: PrefService
  // "Which owner identities does this node know about?" — used by plugins/http when assigning stored
  // request rows to the active owner without scanning plugin tables directly.
  identity: IdentityService
}

export function createCoreServices(options: { secrets: SecretService; db: AppDatabase }): CoreServices {
  return {
    fs,
    git,
    proc,
    secrets: options.secrets,
    tasks: createTaskService(options.db),
    repos: createRepoService(options.db),
    context: createContextService(options.db),
    models: createModelService(options.db, options.secrets),
    prefs: createPrefService(options.db),
    identity: createIdentityService(options.db),
  }
}

export { SecretService }
export type { ChildTaskSeed, TaskLinkRef, TaskRunConfig, TaskService } from './tasks'
export type { IdentityService } from './identity'
export type { RepoCheckout, RepoService } from './repos'
export type { ContextService } from './context'
export type { PrefService } from './prefs'
export type { GenerateTextRequest, ModelService } from './models'
export { SecretUnavailableError, redact } from './secrets'
export type { ProcResult, ProcSpec } from './proc'
export type { ConfineFailure, ConfineResult } from './fs'
