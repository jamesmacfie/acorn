// The place another plugin may say something about this pane's diff (docs/plugins.md § Cooperative
// extension points, the `annotation` kind). The host mints the qualified id from the bare one.
//
// Its own module, with no Solid in it, so both the pane and a bare-Node test can reach it.

/** What another plugin knows about a line of the local diff: coverage, a lint result, a blame note. */
export const DIFF_LINE_POINT = 'changes:diff-line'

// The fields the shared viewer mints per row, in the order it mints them
// (client-core/src/host/annotations/annotationKey.ts). A key declared in any other order looks up under a string
// nothing ever wrote.
export const DIFF_LINE_KEY = ['file', 'line', 'side'] as const
