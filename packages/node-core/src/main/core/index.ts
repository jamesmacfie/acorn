// CoreServices (docs/vNext/plan.md § Phase 2: "fs confinement, git, process broker, secret
// use-scoping, http allowlists, scheduler as CoreServices").
//
// One object handed to a plugin at init, so a plugin consumes core capability through a declared
// surface rather than by deep-importing whichever core module happened to have the helper.
//
// Two of the six named bullets are deliberately absent, and both absences are decisions:
//
//   - **http allowlists.** The thing a per-plugin host allowlist would defend is already defended by
//     construction: every provider's base URL is a hardcoded module constant (api.github.com,
//     api.linear.app/graphql, api.rollbar.com), so the allowlist and the code are the same fact
//     stated twice. The one genuinely user-supplied outbound URL — an agent webhook target — already
//     has a STRONGER guard than a hostname list: plugins/agents' webhookService resolves DNS and
//     rejects non-loopback addresses over plain http, rejects credentials in the URL, and enforces
//     https (see resolvedWebhookTarget). A registry of allowlists protecting constants is the
//     speculative machinery this phase is supposed to be removing, not adding.
//   - **scheduler.** All four periodic jobs on the node (wsHub's revocation sweep, terminal's idle
//     watch, the MCP refresh interval, agents' durable-event flush) ALREADY unref their timers and
//     already clear them on teardown — disposeWsHub calls clearInterval, and the composition root
//     holds terminal's handle. A Scheduler class was written and deleted: it would have replaced four
//     working, drained timers with an abstraction whose only new property (a re-entrancy guard) no
//     current job needs. The consumer that would justify it is moving workflow trigger polling from
//     the CLIENT to the node so a trigger fires with no window open — a behaviour change, not this
//     phase's.
//
// Recorded in docs/vNext/phase2-notes.md.
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
  // Resolve a taskId against core's tables. Once each plugin owns its own SQLite file it cannot query
  // `tasks` itself, so this is the "validated by the owning plugin when dereferenced" seam
  // (docs/vNext/data.md § Plugin DBs).
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
  // "Which owner identities does this node know about?" — the question plugins/http's legacy-row
  // migration has to answer and must not answer by scanning core's and github's tables itself.
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
