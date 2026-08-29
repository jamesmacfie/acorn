// The two places another plugin may say something inside github's pull-request surfaces
// (docs/plugins.md § Cooperative extension points). The host mints the qualified ids from the bare
// ones below.
//
// Its own module, with no Solid in it, so both the pane and a bare-Node test can reach it.

/** What another plugin knows about a line of a pull request's diff: coverage, a lint result, a
 *  blame note. The same shape the changes pane opens over the working tree. */
export const DIFF_LINE_POINT = 'github:diff-line'

// The fields the shared viewer mints per row, in the order it mints them
// (client-core/src/diff/annotationKey.ts). A key declared in any other order looks up under a string
// nothing ever wrote.
export const DIFF_LINE_KEY = ['file', 'line', 'side'] as const

/** Room beside the state, checks and stats on a pull request's overview: a deploy, a stack, a
 *  release train. A `stack` point, because "everyone who has something to say about this PR" is a
 *  real answer here in a way it never is for a task list. */
export const SUMMARY_BADGES_POINT = 'github:summary-badges'

/** How many contributors fit before the host draws a disclosure. The owner sets it because it is the
 *  owner's screen. */
export const SUMMARY_BADGES_MAX = 4
