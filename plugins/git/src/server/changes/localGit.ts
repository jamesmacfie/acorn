// Local-changes review backing: working-tree status, the diff document and blob reads, plus stage,
// commit, discard, and the four remote verbs over the task's worktree. The LocalGitBridge behind the HTTP routes in
// ./routes/localGit.ts. The taskId is the capability, and relative paths are validated inside
// localDiff.ts. Pure Node, so it works in dev:node too. Wired in ./registerChanges.ts.
import { BridgeError, invalidateWorktreeStatus, type CompiledCoreServices, type CoreServices, type PluginHookRegistry } from '@acorn/plugin-api/node'
import { realpath } from 'node:fs/promises'
import type { GitActionResult, LocalGitBridge } from './routes/localGit'
import { abortOperation, branchOf, commitDiffText, commitStaged, discardAll, discardFile, fetchRemote, gitOperation, headCommit, localNewSideText, localStatus, pullRemote, pushBranch, stageAll, stageFiles, unstageAll, unstageFiles } from './localDiff'
import { localDocument, localSearch, localSegments } from './localDocument'
import { buildCommitPrompt, cleanCommitMessage, COMMIT_MESSAGE_SYSTEM, commitDiffScope, commitFiles, splitByBudget, splitPatch } from './commitMessage'
import { COMMIT_MESSAGE_MAX_OUTPUT_TOKENS, emptyLocalStatus } from '../../shared/changes/api'

// The two decisions this plugin lets other plugins take a turn in (docs/plugins/hooks.md § Hooks). Declared
// on the context in ./registerChanges.ts; spelled here because this is where they are run, and a hook whose
// declaration and call site sit in different files drifts.
//
// `before-commit` allows a transform because rewriting the message is the whole point of a commit-lint
// or a message helper; `before-push` does not, because there is nothing in a push worth rewriting and
// a plugin that could change the branch could push somewhere else.
export const CHANGES_HOOKS = [
  {
    id: 'before-commit',
    label: 'commit',
    // `amend` is here so a commit-lint handler can leave an amend alone: rewriting the message of a
    // commit that already exists is a different decision from writing a new one
    // (docs/plugins/hooks.md § Hooks).
    payload: { taskId: 'string', branch: 'string', message: 'string', amend: 'boolean' },
    allows: ['observe', 'transform', 'veto'],
  },
  {
    id: 'before-push',
    label: 'push',
    // `force` is here so a branch-protection handler can refuse the one push that replaces a commit
    // somebody else may be standing on, while leaving an ordinary push alone. Payload matching is
    // exact, so declaring it makes it a field every call carries (docs/plugins/hooks.md § Hooks).
    payload: { taskId: 'string', branch: 'string', force: 'boolean' },
    allows: ['observe', 'veto'],
  },
] as const

// Takes CoreServices, not a database handle: this module shells out to git in the task's worktree
// and needs core's task-to-worktree resolution and its model seam, nothing else
// (docs/data-layer/plugin-databases.md § Plugin databases).
//
// `models` is here for one call, the generated commit message. The alternative was a second bridge
// for one member, and the diff that feeds the prompt is read by this module anyway
// (docs/integrations/model-providers.md § Model providers).
//
// `hooks` is the owner's half of the two points above. Optional so a test can build the bridge with no
// host around it, and absent means nobody objects, which is also what an empty chain means.
//
// `secretPublication` is core's optional gate (docs/security/secret-publication.md). Absent or off,
// commit and push run exactly as before, with no check and no added latency.
export function localGitBridge(
  core: Pick<CoreServices, 'tasks' | 'models'> & Pick<CompiledCoreServices, 'checkoutAdmission' | 'secretPublication'> & Partial<Pick<CoreServices, 'prefs' | 'identity'>>,
  /** `ctx.events.worktreeStatus`: a stage, a commit, a discard or a remote verb moved the dirty
   *  markers, or the counts the branch bar draws beside them. */
  worktreeChanged: (taskId: string) => void = () => {},
  hooks?: Pick<PluginHookRegistry, 'run'>,
): LocalGitBridge {
  // A mutation resolves the root, runs the git action, then announces so dirty markers move. Dropping
  // the coalesced `git status` for the path is `run`'s job in ./localDiff.ts, next to the write itself,
  // so an action reached from anywhere (the agent tools, a test) gets it too.
  const rootOf = async (taskId: string) => {
    const root = await core.tasks.root(taskId)
    if (!root) throw new BridgeError(404, 'not_found', 'No worktree yet.')
    return root
  }
  const withRoot = async (taskId: string, fn: (root: string) => Promise<GitActionResult>): Promise<GitActionResult> => {
    const root = await core.tasks.root(taskId)
    if (!root) return { ok: false, reason: 'No worktree yet.' }
    const res = await fn(root)
    worktreeChanged(taskId)
    return res
  }
  // Acorn's own index writes take turns per worktree, so a stage from the pane cannot land between a
  // commit's secret check and the commit it admits. A Git process outside Acorn is not covered.
  const lanes = new Map<string, Promise<unknown>>()
  const withIndex = (taskId: string, fn: (root: string) => Promise<GitActionResult>) => withRoot(taskId, (root) => {
    const run = (lanes.get(root) ?? Promise.resolve()).then(() => fn(root))
    const settled = run.catch(() => {})
    lanes.set(root, settled)
    void settled.then(() => { if (lanes.get(root) === settled) lanes.delete(root) })
    return run
  })
  return {
    dependencies: async (taskId, scope) => (await import('./dependencyReview')).dependencyReview(await rootOf(taskId), scope, taskId),
    status: async (taskId) => {
      const root = await core.tasks.root(taskId)
      if (!root) return emptyLocalStatus()
      const status = await localStatus(root).catch(() => emptyLocalStatus())
      const owner = core.identity?.active()
      const policy = owner && core.prefs ? await (await import('./pullPolicy')).readPullPolicy(core.prefs, owner).catch(() => null) : null
      return { ...status, pullPolicy: policy === 'rebase' ? 'rebase' : 'ff-only' }
    },
    // The diff as a document, then its segments and search pages (./localDocument.ts). git's default
    // -U3, so the pane shows hunks with expandable gaps between them rather than every line of every
    // file (docs/diff-rendering.md).
    document: async (taskId, request) => ({ files: await localDocument(await rootOf(taskId), request.scope, request.files) }),
    segments: async (taskId, request) => localSegments(await rootOf(taskId), request.scope, request.requests),
    search: async (taskId, { scope, files, ...request }) => localSearch(await rootOf(taskId), scope, files, request),
    newSide: async (taskId, path, scope) => {
      const root = await core.tasks.root(taskId)
      if (!root) return { error: 'No worktree yet.' }
      try {
        return await localNewSideText(root, path, scope === 'staged' ? 'staged' : 'unstaged')
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'read failed' }
      }
    },
    stage: (taskId, paths) => withIndex(taskId, (root) => stageFiles(root, paths)),
    unstage: (taskId, paths) => withIndex(taskId, (root) => unstageFiles(root, paths)),
    discard: (taskId, path, untracked, oldPath) => withIndex(taskId, (root) => discardFile(root, path, !!untracked, oldPath)),
    // The two hooked mutations. The refusal reaches the pane as the same `{ ok: false, reason }` a git
    // failure does, with the blaming plugin's name in front of it, so the owner's UI needs no second
    // shape for "somebody said no" (docs/plugins/hooks.md § Hooks).
    headCommit: async (taskId) => {
      const root = await core.tasks.root(taskId)
      if (!root) return null
      return headCommit(root).catch(() => null)
    },
    commit: (taskId, message, options = {}) => withIndex(taskId, async (root) => {
      const branch = await branchOf(root)
      const verdict = await hooks?.run('before-commit', { taskId, branch, message, amend: !!options.amend })
      if (verdict && !verdict.ok) return { ok: false, reason: `${verdict.by}: ${verdict.reason}` }
      // Transformed, or the original if nobody transformed. One value to act on either way.
      const finalMessage = verdict?.payload.message ?? message
      const gate = core.secretPublication
      if (!gate || !(await gate.enabled())) return commitStaged(root, finalMessage, options)
      // Immediately before the commit and after the optional hook, so an allowance cannot outlive a
      // veto. Loaded only while blocking is on (./secretCheck.ts § gatedCommit).
      return (await import('./secretCheck')).gatedCommit(root, branch, finalMessage, options, gate)
    }),
    stageAll: (taskId) => withIndex(taskId, stageAll),
    unstageAll: (taskId) => withIndex(taskId, unstageAll),
    discardAll: (taskId) => withIndex(taskId, discardAll),
    // The four remote verbs. Each takes 120 seconds rather than the local 30, because the clock is
    // somebody else's server (./localDiff.ts § NETWORK_TIMEOUT_MS).
    fetch: (taskId) => withRoot(taskId, fetchRemote),
    pull: async (taskId, options = {}) => {
      const root = await core.tasks.root(taskId)
      if (!root) return { ok: false, reason: 'No worktree yet.' }
      const owner = core.identity?.active()
      const preference = options.rebase === undefined && owner && core.prefs ? await (await import('./pullPolicy')).readPullPolicy(core.prefs, owner) : null
      try {
        return await core.checkoutAdmission.write(taskId, async (checkout) => {
          if (await realpath(root) !== await realpath(checkout)) return { ok: false, reason: 'Target checkout moved. Refresh and try again.' }
          const task = await core.tasks.load(taskId)
          invalidateWorktreeStatus(root)
          const status = await localStatus(root)
          if (!task || (task.branch && status.branch !== task.branch)) return { ok: false, reason: 'Task branch changed. Refresh and try again.' }
          if (status.operation || status.changes.length) return { ok: false, reason: 'Finish the current operation and commit or discard local changes before pulling.' }
          const result = await pullRemote(root, { rebase: options.rebase ?? (preference === 'rebase') })
          worktreeChanged(taskId)
          return result
        })
      } catch (error) {
        if (error instanceof BridgeError) return { ok: false, reason: error.message }
        throw error
      }
    },
    push: (taskId, options = {}) => withRoot(taskId, async (root) => {
      const branch = await branchOf(root)
      const verdict = await hooks?.run('before-push', { taskId, branch, force: !!options.force })
      if (verdict && !verdict.ok) return { ok: false, reason: `${verdict.by}: ${verdict.reason}` }
      const gate = core.secretPublication
      if (!gate || !(await gate.enabled())) return pushBranch(root, options)
      return (await import('./secretCheck')).gatedPush(root, branch, options, gate)
    }),
    // The same checks, run on request with blocking off or on. Reports only; nothing is admitted.
    secretCheck: async (taskId, operation) => (await import('./secretCheck')).manualSecretCheck(await rootOf(taskId), operation),
    // Which operation to abort is read off the tree here, not taken from the caller: `merge` and
    // `rebase` are argv, and the panel only offers Abort while its own status read says one is in
    // flight. A request that arrives after somebody finished the rebase in a terminal is refused
    // rather than guessed at (docs/security/process-and-paths.md § Process, path, and configuration controls).
    abort: (taskId) => withRoot(taskId, async (root) => {
      const operation = await gitOperation(root, { fresh: true })
      if (!operation) return { ok: false, reason: 'No Git operation is in progress.' }
      return abortOperation(root, operation)
    }),
    // Ids and labels of the backends this owner could generate with: a stored key, or an agent CLI
    // installed on this machine. Core resolves the key, or the command, inside `generateText`; nothing
    // here has ever seen either.
    modelBackends: (userId) => core.models.available(userId),
    // Ask a connected provider for the message the next commit should carry.
    //
    // Not a `withRoot` mutation: it writes nothing, moves no marker, and its answer goes into a field
    // the reader can still edit. The refusals are `BridgeError`s rather than `{ ok: false, reason }`,
    // because this is the one call in the file whose failure the client has to tell apart — a tree
    // with nothing to describe is a different problem from a provider that needs reconnecting
    // (./routes/localGit.ts maps both).
    commitMessage: async (taskId, request) => {
      const root = await core.tasks.root(taskId)
      if (!root) throw new BridgeError(404, 'not_found', 'No worktree yet.')
      const status = await localStatus(root)
      // The scope comes from this read, not from the request: the panel's copy of the status is up to
      // one poll old, and the message has to describe what the next commit will actually contain.
      const scope = commitDiffScope(status.changes)
      // Refused before the provider call, which is the point of doing it here: an empty diff would
      // spend a key to be told there is nothing to say.
      if (!scope) throw new BridgeError(422, 'nothing_to_commit', 'Nothing staged or changed to describe.')
      const files = commitFiles(status.changes, scope)
      const { include, omit } = splitByBudget(files)
      const patch = await commitDiffText(root, scope === 'staged', include.map((file) => file.path))
      const result = await core.models.generateText({
        userId: request.userId,
        backendId: request.backendId,
        input: {
          system: COMMIT_MESSAGE_SYSTEM,
          prompt: buildCommitPrompt({ branch: status.branch, scope, include, omit, patches: splitPatch(patch) }),
          ...(request.modelId ? { modelId: request.modelId } : {}),
          maxOutputTokens: COMMIT_MESSAGE_MAX_OUTPUT_TOKENS,
        },
      })
      return { message: cleanCommitMessage(result.text), providerId: result.providerId, modelId: result.modelId }
    },
  }
}

