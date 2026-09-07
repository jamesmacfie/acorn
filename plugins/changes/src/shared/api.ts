// The changes plugin's wire contract: the working-tree review pane and its inline notes.
//
// Types, route builders, and the query key live together, following the docker and http convention:
// the plugin that owns the namespace owns the shape of what crosses it. The query key is
// byte-identical to the one in @acorn/protocol/api.ts, because changing it orphans a user's
// IndexedDB (docs/caching.md).

import type { LocalStatus } from '@acorn/protocol/terminal.ts'

// Inline annotations on uncommitted changes, owned by this plugin rather than mirrored from GitHub.
export type ReviewNote = {
  id: string
  taskId: string
  path: string
  side: 'additions' | 'deletions'
  startLine: number
  endLine: number
  snippet: string | null
  body: string
  sentAt: number | null // stamped on delivery; cleared on edit
  createdAt: number
}
export type ReviewNoteSeed = Pick<ReviewNote, 'path' | 'side' | 'startLine' | 'endLine' | 'body'> & { snippet?: string | null }

export const reviewNotesRoute = (taskId: string) => `/v2/p/changes/tasks/${taskId}/review-notes`
export const reviewNoteRoute = (taskId: string, noteId: string) => `/v2/p/changes/tasks/${taskId}/review-notes/${noteId}`
export const reviewNotesSentRoute = (taskId: string) => `/v2/p/changes/tasks/${taskId}/review-notes/sent`
export const reviewNotesKey = (taskId: string) => ['review-notes', taskId] as const

// Local-changes review: working-tree status, diff and blob reads, plus the staging, commit, discard
// and remote actions.
export const localStatusRoute = (taskId: string) => `/v2/p/changes/tasks/${taskId}/local/status`
/** A clean tree with nothing known about the branch: what a task with no worktree yet looks like, and
 *  what the pane renders before its first read returns. A function rather than a constant so no two
 *  callers share one `changes` array. */
export const emptyLocalStatus = (): LocalStatus => ({ branch: null, upstream: null, ahead: null, behind: null, operation: null, changes: [] })
export const localDiffRoute = (taskId: string, path: string, scope: 'unstaged' | 'staged') =>
  `/v2/p/changes/tasks/${taskId}/local/diff?path=${encodeURIComponent(path)}&scope=${scope}`
// The new side of a file's diff, for filling a gap the reader expands. Scoped like the diff itself:
// the index for a staged diff, the working tree for an unstaged one.
export const localNewSideRoute = (taskId: string, path: string, scope: 'unstaged' | 'staged') =>
  `/v2/p/changes/tasks/${taskId}/local/new-side?path=${encodeURIComponent(path)}&scope=${scope}`
export const localActionRoute = (
  taskId: string,
  action: 'stage' | 'unstage' | 'discard' | 'commit' | 'stage-all' | 'unstage-all' | 'discard-all' | 'fetch' | 'pull' | 'push' | 'abort',
) => `/v2/p/changes/tasks/${taskId}/local/${action}`
/** What the commit menu offers, as the body a commit POST carries.
 *
 *  `all` is the client's answer to "nothing is staged": `git commit -a` stages every tracked
 *  modification and deletion and leaves untracked files alone, which is what the button that sets it
 *  says. `noVerify` skips git's own pre-commit and commit-msg hooks; acorn's `before-commit` chain
 *  runs either way (docs/plugins.md § Hooks). */
export type CommitOptions = { all?: boolean; amend?: boolean; signoff?: boolean; noVerify?: boolean }

/** HEAD's hash and full message, which is what an amend puts in an empty field. */
export type HeadCommit = { sha: string; message: string }

/** What the remote menu's two variable verbs carry.
 *
 *  `rebase` is the menu's Pull with rebase, where a bare Pull is fast-forward only. `force` adds
 *  `--force-with-lease`, which refuses to replace a commit this node has not fetched. Both are
 *  strictly booleans on the wire, for the reason the commit flags are: a coerced `'yes'` would run
 *  the destructive half of a verb nobody chose. */
export type PullOptions = { rebase?: boolean }
export type PushOptions = { force?: boolean }

// HEAD's hash and message. Read on demand rather than carried on the status record: the only thing
// that wants it is an amend, which is a menu item nobody presses on most visits, and a message body
// on every poll is bytes the panel never draws.
export const localHeadCommitRoute = (taskId: string) => `/v2/p/changes/tasks/${taskId}/local/head-commit`

// --- the generated commit message ---

/** How many characters of diff the commit-message prompt may carry.
 *
 *  A task's diff can be megabytes and a provider charges by the token, so the prompt is bounded here
 *  rather than wherever it is assembled. Sized like the database plugin's `GENERATE_MAX_PROMPT_CHARS`,
 *  three times over, because that one bounds a sentence a person typed and this one bounds a patch. */
export const COMMIT_MESSAGE_MAX_PROMPT_CHARS = 12_000

/** How much the model may write back. A subject and a short body, not a review. */
export const COMMIT_MESSAGE_MAX_OUTPUT_TOKENS = 512

/** Which connection and model the wand spends, as the body a commit-message POST carries and as the
 *  device preference that remembers the last pick. `modelId` is `''` when the provider declares
 *  neither a default nor a list, which is a real answer: the node omits it and the provider runtime
 *  falls back to its adapter's recommendation (@acorn/protocol/modelProviders.ts). */
export type ModelPick = { connectionId: string; modelId: string }

/** The body a commit-message POST carries. `modelId` is absent rather than empty when the provider
 *  declares no model, so the node has nothing to pass on and the runtime picks. */
export type CommitMessageRequest = { connectionId: string; modelId?: string }

/** What the route answers: the message, and which provider and model wrote it. The two ids are for
 *  the reader, so a message that came out wrong can be traced to the model that wrote it. */
export type GeneratedCommitMessage = { message: string; providerId: string; modelId: string }

export const localCommitMessageRoute = (taskId: string) => `/v2/p/changes/tasks/${taskId}/local/commit-message`
/** Which model connections this owner could generate with, ids and labels only.
 *
 *  This plugin's own route rather than a read of core's connection roster: `/v2/core/integrations` has
 *  no bridge scope, and minting one would hand every installed plugin every connection to serve one
 *  dropdown (docs/integrations.md § Model providers). */
export const localModelConnectionsRoute = (taskId: string) => `/v2/p/changes/tasks/${taskId}/local/model-connections`
