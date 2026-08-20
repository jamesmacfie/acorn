// How a pull request is named outside its own pane: `owner/repo#number`.
//
// One module, because four places had grown their own spelling of the same identity: the collection
// row's `id`, the content-link recogniser's `item`, the reference panel parsing it back, and the "is
// there already a task for this?" check. Each was correct in isolation, and a set of
// independently-correct spellings of one identity is what produced the owner-casing bug.
//
// A bare number can't do this job, because `#42` isn't unique across repositories and a dashboard panel
// is cross-repository by definition.

export type PullRef = { owner: string; repo: string; number: string }

/** The canonical spelling. GitHub's own casing is preserved, because this is a display id as well as a
 *  key. */
export const formatPullRef = (owner: string, repo: string, number: string | number): string =>
  `${owner}/${repo}#${number}`

const PULL_REF = /^([^/]+)\/([^#]+)#(\d+)$/

/** The inverse, or null for anything that isn't one, so a panel handed a stranger's displayId says so
 *  rather than rendering an empty shell. */
export function parsePullRef(value: string): PullRef | null {
  const match = PULL_REF.exec(value)
  return match ? { owner: match[1], repo: match[2], number: match[3] } : null
}

// Case-insensitively on owner and repo, for the reason ../client/contentLinks.ts spells out: GitHub
// treats both as case-insensitive, and the two sides of any comparison here come from different
// writers. Core's `projects` stores them folded, github's mirror keeps GitHub's canonical spelling, and
// a URL carries whichever the author typed.
const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** Does this reference name this task's pull request? The task side is `(github.owner/name,
 *  pullNumber)`, which is how a github-pr task records its PR: on the row, never as a link. */
export function pullRefMatchesTask(value: string, github: { owner: string; name: string }, pullNumber: number): boolean {
  const ref = parsePullRef(value)
  return !!ref && sameName(ref.owner, github.owner) && sameName(ref.repo, github.name) && ref.number === String(pullNumber)
}
