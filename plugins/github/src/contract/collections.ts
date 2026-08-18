import type {
  PluginCollectionResponse,
  PluginCollectionRowBody,
  PluginCollectionSchema,
} from '@acorn/protocol/collections.ts'
import { formatPullRef } from './pullRef'

// GitHub's open pull requests, expressed as a COLLECTION (@acorn/protocol/collections.ts): a typed set
// of records the host draws with its own components, so the same rows can sit on a board beside another
// plugin's without either plugin knowing the other exists.
//
// In contract/ rather than server/ because both halves need it: the node route builds its response
// against this schema, and the client's `ctx.collections.register` declares the same object as the
// STATIC schema, so a panel editor can offer views before the first fetch. One declaration, two
// readers — a second copy is a column that renders under a different name than it sorts by.
export const PULLS_COLLECTION_ID = 'pulls-mine'
export const pullsCollectionRoute = `/v2/p/github/collections/${PULLS_COLLECTION_ID}`

/** The one status value a row carries, projected from THREE mirror columns. See `pullStatus`. */
export type PullCollectionStatus = 'draft' | 'open' | 'unstable' | 'behind' | 'blocked' | 'conflicts' | 'ready'

// GitHub says "what state is this PR in" three times — `state`, `draft`, and `mergeStateStatus` — and no
// two of them are independent. That is the interesting half of expressing this as a collection: the wire
// vocabulary has ONE enum per field, so the plugin has to decide what its status actually is instead of
// handing the host three columns and a rendering problem. It reads better than the mirror does.
//
// Declaration order is group order: a board grouped by this column reads left to right the way a pull
// request moves. Tones are the host's own StatusDot vocabulary, so an appearance pack owns the colour.
const STATUS_VALUES = [
  { id: 'draft', label: 'Draft', tone: 'muted' },
  { id: 'open', label: 'Open', tone: 'accent' },
  { id: 'unstable', label: 'Checks failing', tone: 'warn' },
  { id: 'behind', label: 'Behind base', tone: 'warn' },
  { id: 'blocked', label: 'Blocked', tone: 'warn' },
  { id: 'conflicts', label: 'Conflicts', tone: 'bad' },
  { id: 'ready', label: 'Ready to merge', tone: 'ok' },
] as const satisfies { id: PullCollectionStatus; label: string; tone: string }[]

export const pullsCollectionSchema: PluginCollectionSchema = {
  fields: [
    { id: 'title', name: 'Title', type: 'text', role: 'title' },
    { id: 'repo', name: 'Repository', type: 'text' },
    { id: 'number', name: 'Number', type: 'number' },
    { id: 'status', name: 'Status', type: 'enum', role: 'status', values: [...STATUS_VALUES] },
    { id: 'author', name: 'Author', type: 'person', role: 'assignee' },
    { id: 'updated', name: 'Updated', type: 'datetime', role: 'updated' },
    { id: 'autoMerge', name: 'Auto-merge', type: 'boolean' },
    { id: 'url', name: 'Link', type: 'link', role: 'url' },
  ],
}

/** Which of the seven a mirrored row is. Ordered by what a person needs to know first: a draft is a
 *  draft whatever its merge state, and a conflict outranks the checks that cannot run because of it. */
export const pullStatus = (row: {
  draft: boolean
  mergeable: string | null
  mergeStateStatus: string | null
}): PullCollectionStatus => {
  if (row.draft) return 'draft'
  if (row.mergeable === 'CONFLICTING' || row.mergeStateStatus === 'DIRTY') return 'conflicts'
  if (row.mergeStateStatus === 'BLOCKED') return 'blocked'
  if (row.mergeStateStatus === 'BEHIND') return 'behind'
  if (row.mergeStateStatus === 'UNSTABLE') return 'unstable'
  if (row.mergeStateStatus === 'CLEAN' || row.mergeStateStatus === 'HAS_HOOKS') return 'ready'
  // UNKNOWN, or a repo whose detail has never been fetched. "Open" is the honest answer: the mirror
  // holds no merge state for a PR nobody has opened, and inventing `ready` from silence would tell
  // someone a branch is mergeable when nothing has checked.
  return 'open'
}

// ── "…involving me", and why it does not read the mirror ───────────────────────────────────────────
//
// The three questions a person actually asks a PR dashboard. Declared as ONE enum param rather than
// three booleans because the param vocabulary has no boolean, and because they are how you're involved
// — a single answer reads better in a dropdown than three checkboxes that can contradict each other.
//
// Unset is the collection's original behaviour: every open PR in every mirrored repo.
//
// Two of the three CANNOT be answered from the mirror, which is the whole reason this exists as a
// search rather than another `where` clause. Assignees are not mirrored at all — no column, no table.
// Review requests are mirrored, but only by the PR-DETAIL sync (server/routes/prMirror.ts), so the
// mirror knows you were asked to review exactly the pull requests you already opened — the precise
// complement of what someone asking "what's waiting on me" wants to see. A mirror-side filter would
// have parsed, rendered, and quietly answered "nothing".
export const PULL_INVOLVEMENT = ['review-requested', 'assigned', 'authored'] as const
export type PullInvolvement = (typeof PULL_INVOLVEMENT)[number]

const INVOLVEMENT_QUALIFIER: Record<PullInvolvement, string> = {
  'review-requested': 'review-requested:@me',
  assigned: 'assignee:@me',
  authored: 'author:@me',
}

/** `owner/name`, and nothing that could carry a second search qualifier in on a space. The mirror path
 *  gets the same shape for free by splitting on `/`; here it is a guard, because this string is
 *  interpolated into a query GitHub parses. Anything else is dropped, which searches wider rather than
 *  somewhere unintended. */
const REPO_QUALIFIER = /^[\w.-]+\/[\w.-]+$/

/** The GitHub search that answers one involvement. `@me` is the load-bearing part: GitHub resolves it
 *  against the token, so the route never has to know or store which login is us. */
export const pullsSearchQuery = (involvement: PullInvolvement, repo = ''): string =>
  ['is:pr', 'is:open', 'archived:false', INVOLVEMENT_QUALIFIER[involvement], REPO_QUALIFIER.test(repo) ? `repo:${repo}` : '']
    .filter(Boolean)
    .join(' ')

/** The param's value is a comma-joined set, because "assigned to me OR waiting on my review" is one
 *  question a person asks and GitHub's qualifiers only AND. So the route runs one search per involvement
 *  and unions the results — which is why this parses to a LIST rather than a value, and why an
 *  unrecognised entry is dropped instead of failing: a saved panel outlives the vocabulary. */
export const parsePullInvolvement = (value: string): PullInvolvement[] =>
  PULL_INVOLVEMENT.filter((entry) => value.split(',').includes(entry))

/** The mirror columns a row needs. Spelled here rather than imported from the drizzle table, so the
 *  projection stays readable from the client half and testable without a database. Search fills the
 *  same shape (server/routes/collections.ts), so both paths render one set of columns. */
export type PullCollectionSource = {
  owner: string
  repo: string
  number: number
  title: string
  draft: boolean
  author: string | null
  updatedAt: number | null
  mergeable: string | null
  mergeStateStatus: string | null
  autoMergeEnabled: boolean
}

export const pullsCollectionPage = (rows: readonly PullCollectionSource[]): PluginCollectionResponse => ({
  // The response repeats the same object the client declares as its static schema. GitHub is compiled
  // and has no manifest at all, so there is no third place for the two to disagree.
  schema: pullsCollectionSchema,
  rows: rows.map((row): PluginCollectionRowBody => {
    const url = `https://github.com/${row.owner}/${row.repo}/pull/${row.number}`
    return {
      // Stable across refreshes and unique across repositories, which a bare PR number is not. Spelled
      // by ./pullRef.ts, which is the one owner of this identity — a recognised URL and the reference
      // panel resolve to the same string through the same helper.
      id: formatPullRef(row.owner, row.repo, row.number),
      values: {
        title: row.title,
        repo: `${row.owner}/${row.repo}`,
        number: row.number,
        status: pullStatus(row),
        author: row.author,
        updated: row.updatedAt,
        autoMerge: row.autoMergeEnabled,
        url,
      },
      // `openUrl` and not `openPane`: a row on a dashboard has no task, and the PR pane belongs to one.
      // The verb set is the manifest's context-free union, so a click can do exactly what a command can
      // do and nothing more.
      //
      // It does NOT follow that the click leaves acorn. The URL is this PR's durable identity, and the
      // host resolves it late against the content-link recognisers — github's own `github.pull-request`
      // declares the route (client/contentLinks.ts § path), so a tracked repo lands on `/p/:projectId/
      // pulls/:number` and only an untracked one reaches github.com. Which is why this stays a URL
      // rather than becoming a routed verb: the row cannot know the project, and by the time someone
      // clicks, the client can look it up.
      action: { verb: 'openUrl', url },
    }
  }),
})
