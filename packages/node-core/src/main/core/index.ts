import type { AppDatabase } from '../../server/db'
import type { ActiveIdentityStore } from '../activeIdentity'
import { createContextService, type ContextService } from './context/launch'
import * as fs from './filesystem/confinement'
import * as git from './vcs/git'
import { createIdentityService, type IdentityService } from './identity/identity'
import { createModelService, type ModelService } from './models/text'
import { createPrefService, type PrefService } from './identity/preferences'
import * as proc from './exec/proc'
import { createRepoService, type RepoService } from './vcs/repos'
import { SecretService } from './security/secrets'
import { createTaskService, type TaskService } from './tasks/service'
import type { CapabilityRegistry } from '../../server/plugin/capabilities'

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
  // The machine identity: which owner this node is bound to, which identities it knows about, and the
  // bind/unbind writes. Core owns it — a plugin used to write it directly (main/core/identity.ts).
  identity: IdentityService
}

export function createCoreServices(options: {
  secrets: SecretService
  db: AppDatabase
  // The persisted binding. Required rather than defaulted, so a composition root cannot end up with a
  // process-local identity by omission; tests pass memoryIdentityStore() (main/activeIdentity.ts).
  activeIdentity: ActiveIdentityStore
  capabilities?: Pick<CapabilityRegistry, 'get'>
}): CoreServices {
  return {
    fs,
    git,
    proc,
    secrets: options.secrets,
    tasks: createTaskService(options.db, options.capabilities),
    repos: createRepoService(options.db),
    context: createContextService(options.db),
    models: createModelService(options.db, options.secrets),
    prefs: createPrefService(options.db),
    identity: createIdentityService(options.db, options.activeIdentity),
  }
}

export { SecretService }
export type { ChildTaskSeed, TaskLinkRef, TaskRunConfig, TaskService } from './tasks/service'
export type { IdentityService } from './identity/identity'
export type { RepoCheckout, RepoService } from './vcs/repos'
export type { ContextService } from './context/launch'
export type { PrefService } from './identity/preferences'
export type { GenerateTextRequest, ModelService } from './models/text'
export { SecretUnavailableError, redact } from './security/secrets'
export type { ProcResult, ProcSpec } from './exec/proc'
export type { ConfineFailure, ConfineResult } from './filesystem/confinement'
