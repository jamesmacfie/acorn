// How a pull request is NAMED outside its own pane: `owner/repo#number`.
//
// One module because four places had grown their own spelling of the same identity — the collection
// row's `id`, the content-link recogniser's `item`, the reference panel parsing it back, and the
// "is there already a task for this?" check comparing it to a task row. Every one of them was correct
// in isolation, and a set of independently-correct spellings of one identity is precisely the shape
// that produced the owner-casing bug: two implementations of a lookup, fixed in one of them.
//
// A bare number cannot do this job — `#42` is not unique across repositories, and a dashboard panel is
// cross-repository by definition — which is why the identity carries the repo at all.

export type PullRef = { owner: string; repo: string; number: string }

/** The canonical spelling. GitHub's own casing is preserved, because this is a display id as well as a key. */
export const formatPullRef = (owner: string, repo: string, number: string | number): string =>
  `${owner}/${repo}#${number}`

const PULL_REF = /^([^/]+)\/([^#]+)#(\d+)$/

/** The inverse, or null for anything that is not one — a panel handed a stranger's displayId says so
 *  rather than rendering an empty shell. */
export function parsePullRef(value: string): PullRef | null {
  const match = PULL_REF.exec(value)
  return match ? { owner: match[1], repo: match[2], number: match[3] } : null
}

// CASE-INSENSITIVELY on owner and repo, for the reason spelled out at length in
// ../client/contentLinks.ts: GitHub treats both as case-insensitive, and the two sides of any comparison
// here come from different writers — core's `projects` stores them folded, github's own mirror keeps
// GitHub's canonical spelling, and a URL carries whichever the author typed.
const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** Does this reference name this task's pull request? The task side is `(github.owner/name, pullNumber)`,
 *  which is how a github-pr task records its PR — on the row, never as a link. */
export function pullRefMatchesTask(value: string, github: { owner: string; name: string }, pullNumber: number): boolean {
  const ref = parsePullRef(value)
  return !!ref && sameName(ref.owner, github.owner) && sameName(ref.repo, github.name) && ref.number === String(pullNumber)
}
