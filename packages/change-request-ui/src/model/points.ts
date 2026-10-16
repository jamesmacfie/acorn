// The two places another plugin may say something inside a code host's change request surfaces
// (docs/plugins/cooperative-extension-points.md § Cooperative extension points). Each code host opens
// its own pair, such as `github:diff-line` and `gitlab:diff-line`, from these declarations, so a
// contributor that wants every host files the same code against each host's point.
//
// Its own module, with no Solid in it, so a client entry and a bare-Node test can both reach it.

// The fields the shared viewer mints per row, in the order it mints them (`annotationKey` in
// client-core). A key declared in any other order looks up under a string nothing ever wrote.
export const DIFF_LINE_KEY = ['file', 'line', 'side'] as const

/** How many contributors fit on the overview before the host draws a disclosure. */
export const SUMMARY_BADGES_MAX = 4

/** What a `summary-badges` contributor receives. `owner` is the repository's namespace: a GitHub owner,
 *  or a GitLab group path such as `group/sub`. */
export type SummaryBadgesProps = { owner: string; repo: string; number: string }

/** The two points, as `ctx.extensionPoints.register` takes them. `noun` is the host's word, such as
 *  `Pull request`. Marks on a line of the diff, keyed the way the shared viewer keys a row, and room
 *  beside the state and checks on the overview, where the owner's own facts stay. */
export const changeRequestPoints = (noun: string) =>
  [
    { id: 'diff-line', label: `${noun} diff line`, kind: 'annotation', key: [...DIFF_LINE_KEY], max: 4 },
    { id: 'summary-badges', label: `${noun} summary`, kind: 'remote', mode: 'stack', max: SUMMARY_BADGES_MAX },
  ] as const

/** A host's qualified point ids, which the host mints from the bare ones above. */
export const changeRequestPointIds = (pluginId: string) => ({
  diffLine: `${pluginId}:diff-line`,
  summaryBadges: `${pluginId}:summary-badges`,
})
