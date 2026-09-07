// Local-changes review backing: working-tree status, per-file patch and blob reads, plus stage,
// commit, discard, and the four remote verbs over the task's worktree. The LocalGitBridge behind the HTTP routes in
// ./routes/localGit.ts. The taskId is the capability, and relative paths are validated inside
// localDiff.ts. Pure Node, so it works in dev:node too. Wired in ../node/index.ts.
import { BridgeError, type CoreServices, type PluginHookRegistry } from '@acorn/plugin-api/node'
import type { LocalGitBridge } from './routes/localGit'
import { abortOperation, branchOf, commitDiffText, commitStaged, discardAll, discardFile, fetchRemote, gitOperation, headCommit, localDiff, localNewSideText, localStatus, pullRemote, pushBranch, stageAll, stageFiles, unstageAll, unstageFiles } from './localDiff'
import { buildCommitPrompt, cleanCommitMessage, COMMIT_MESSAGE_SYSTEM, commitDiffScope, commitFiles, splitByBudget, splitPatch } from './commitMessage'
import { COMMIT_MESSAGE_MAX_OUTPUT_TOKENS, emptyLocalStatus } from '../shared/api'

// The two decisions this plugin lets other plugins take a turn in (docs/plugins.md § Hooks). Declared
// on the context in ../node/index.ts; spelled here because this is where they are run, and a hook whose
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
    // (docs/plugins.md § Hooks).
    payload: { taskId: 'string', branch: 'string', message: 'string', amend: 'boolean' },
    allows: ['observe', 'transform', 'veto'],
  },
  {
    id: 'before-push',
    label: 'push',
    // `force` is here so a branch-protection handler can refuse the one push that replaces a commit
    // somebody else may be standing on, while leaving an ordinary push alone. Payload matching is
    // exact, so declaring it makes it a field every call carries (docs/plugins.md § Hooks).
    payload: { taskId: 'string', branch: 'string', force: 'boolean' },
    allows: ['observe', 'veto'],
  },
] as const

// Takes CoreServices, not a database handle: this module shells out to git in the task's worktree
// and needs core's task-to-worktree resolution and its model seam, nothing else
// (docs/data-layer.md § Plugin databases).
//
// `models` is here for one call, the generated commit message. The alternative was a second bridge
// for one member, and the diff that feeds the prompt is read by this module anyway
// (docs/integrations.md § Model providers).
//
// `hooks` is the owner's half of the two points above. Optional so a test can build the bridge with no
// host around it, and absent means nobody objects, which is also what an empty chain means.
export function localGitBridge(
  core: Pick<CoreServices, 'tasks' | 'models'>,
  /** `ctx.events.worktreeStatus`: a stage, a commit, a discard or a remote verb moved the dirty
   *  markers, or the counts the branch bar draws beside them. */
  worktreeChanged: (taskId: string) => void = () => {},
  hooks?: Pick<PluginHookRegistry, 'run'>,
): LocalGitBridge {
  // A mutation resolves the root, runs the git action, then announces so dirty markers move. Dropping
  // the coalesced `git status` for the path is `run`'s job in ./localDiff.ts, next to the write itself,
  // so an action reached from anywhere (the agent tools, a test) gets it too.
  const withRoot = async (taskId: string, fn: (root: string) => Promise<{ ok: boolean; reason?: string }>) => {
    const root = await core.tasks.root(taskId)
    if (!root) return { ok: false, reason: 'No worktree yet.' }
    const res = await fn(root)
    worktreeChanged(taskId)
    return res
  }
  return {
    status: async (taskId) => {
      const root = await core.tasks.root(taskId)
      if (!root) return emptyLocalStatus()
      return localStatus(root).catch(() => emptyLocalStatus())
    },
    diff: async (taskId, path, scope) => {
      const root = await core.tasks.root(taskId)
      if (!root) return { error: 'No worktree yet.' }
      try {
        // Whole-file context: the pane shows the entire file with changes highlighted, so no expand
        // affordances are needed. 1e6 lines caps any real file.
        // git's default -U3, so the pane shows hunks with expandable gaps between them rather than
        // every line of every file (docs/diff-rendering.md).
        return await localDiff(root, path, scope === 'staged' ? 'staged' : 'unstaged')
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'diff failed' }
      }
    },
    newSide: async (taskId, path, scope) => {
      const root = await core.tasks.root(taskId)
      if (!root) return { error: 'No worktree yet.' }
      try {
        return await localNewSideText(root, path, scope === 'staged' ? 'staged' : 'unstaged')
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'read failed' }
      }
    },
    stage: (taskId, paths) => withRoot(taskId, (root) => stageFiles(root, paths)),
    unstage: (taskId, paths) => withRoot(taskId, (root) => unstageFiles(root, paths)),
    discard: (taskId, path, untracked) => withRoot(taskId, (root) => discardFile(root, path, !!untracked)),
    // The two hooked mutations. The refusal reaches the pane as the same `{ ok: false, reason }` a git
    // failure does, with the blaming plugin's name in front of it, so the owner's UI needs no second
    // shape for "somebody said no" (docs/plugins.md § Hooks).
    headCommit: async (taskId) => {
      const root = await core.tasks.root(taskId)
      if (!root) return null
      return headCommit(root).catch(() => null)
    },
    commit: (taskId, message, options = {}) => withRoot(taskId, async (root) => {
      const verdict = await hooks?.run('before-commit', { taskId, branch: await branchOf(root), message, amend: !!options.amend })
      if (verdict && !verdict.ok) return { ok: false, reason: `${verdict.by}: ${verdict.reason}` }
      // Transformed, or the original if nobody transformed. One value to act on either way.
      return commitStaged(root, verdict?.payload.message ?? message, options)
    }),
    stageAll: (taskId) => withRoot(taskId, stageAll),
    unstageAll: (taskId) => withRoot(taskId, unstageAll),
    discardAll: (taskId) => withRoot(taskId, discardAll),
    // The four remote verbs. Each takes 120 seconds rather than the local 30, because the clock is
    // somebody else's server (./localDiff.ts § NETWORK_TIMEOUT_MS).
    fetch: (taskId) => withRoot(taskId, fetchRemote),
    pull: (taskId, options = {}) => withRoot(taskId, (root) => pullRemote(root, options)),
    push: (taskId, options = {}) => withRoot(taskId, async (root) => {
      const verdict = await hooks?.run('before-push', { taskId, branch: await branchOf(root), force: !!options.force })
      if (verdict && !verdict.ok) return { ok: false, reason: `${verdict.by}: ${verdict.reason}` }
      return pushBranch(root, options)
    }),
    // Which operation to abort is read off the tree here, not taken from the caller: `merge` and
    // `rebase` are argv, and the panel only offers Abort while its own status read says one is in
    // flight. A request that arrives after somebody finished the rebase in a terminal is refused
    // rather than guessed at (docs/security.md § Process, path, and configuration controls).
    abort: (taskId) => withRoot(taskId, async (root) => {
      const operation = await gitOperation(root)
      if (!operation) return { ok: false, reason: 'No merge or rebase is in progress.' }
      return abortOperation(root, operation)
    }),
    // Ids and labels of the connections this owner could generate with. Core resolves the key inside
    // `generateText`; nothing here has ever seen one.
    modelConnections: (userId) => core.models.available(userId),
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
        connectionId: request.connectionId,
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
