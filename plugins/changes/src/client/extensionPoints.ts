// The two places another plugin may come into this pane (docs/plugins.md § Cooperative extension
// points): a mark on a line of the diff, and a button under the branch bar once the work is pushed.
// The host mints the qualified ids from the bare ones. The node-side `changes:before-commit` and
// `changes:before-push` hooks are declared in ../node/index.ts instead, because a hook runs there.
//
// Its own module, with no Solid in it, so both the pane and a bare-Node test can reach it.

/** What another plugin knows about a line of the local diff: coverage, a lint result, a blame note. */
export const DIFF_LINE_POINT = 'changes:diff-line'

// The fields the shared viewer mints per row, in the order it mints them
// (client-core/src/host/annotations/annotationKey.ts). A key declared in any other order looks up under a string
// nothing ever wrote.
export const DIFF_LINE_KEY = ['file', 'line', 'side'] as const

/** What another plugin may offer once this branch is on its remote: open a pull request today, open a
 *  preview or start a deploy tomorrow. Drawn as a `Slot` under the branch bar, in `stack` mode,
 *  because two plugins with something to do after a push is a real answer. */
export const PUSH_ACTIONS_POINT = 'changes:push-actions'

/** How many contributors fit before the host draws a disclosure. Two, because a third would be a
 *  toolbar, and a toolbar in somebody else's footer is a design nobody has asked for. */
export const PUSH_ACTIONS_MAX = 2

/**
 * What a contributor to `changes:push-actions` is handed: the five scalars the bar itself reads.
 *
 * Facts, never markup, and nothing this plugin does not already know. It cannot say "pull request"
 * and does not need to — a contributor asks its own side about anything else, which is how the GitHub
 * plugin reads a task's pull number off its own task query rather than out of these props.
 */
export type PushActionsProps = {
  taskId: string
  projectId: string
  /** The checked-out branch, or `null` on a detached HEAD. */
  branch: string | null
  /** The tracking branch, or `null` when this branch has never been pushed. */
  upstream: string | null
  /** Commits this branch has that its upstream does not, `null` when there is no upstream. */
  ahead: number | null
}
