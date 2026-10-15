import { Hono } from 'hono'
import {
  type AppEnv,
  type CoreServices,
  ownerId,
  type PluginDatabase,
  requireDevice,
  respondError,
} from '@acorn/plugin-api/node'
import type { BrowserPanelBlock, BrowserPanelView } from '@acorn/protocol/plugin/handoffs.ts'
import type { Check, PullDetail } from '../shared/api'
import { readPullDetail } from './routes/pulls/pullDetail'
import { checkFailed, checkPending } from './mirrorQueries'
import { githubToken } from './githubToken'
import type { GithubEmit } from './events'

// The task's pull request in the browser extension's sidebar (docs/plugin-authoring/browser-panel.md).
// It reads the same mirror the PR pane does and is read-only: Open in Acorn goes to the `pr` pane for
// anything that acts on the pull request.

type Severity = Extract<BrowserPanelBlock, { kind: 'rows' }>['rows'][number]['severity']
type Link = Extract<BrowserPanelBlock, { kind: 'links' }>['links'][number]

export const browserPanel = (
  db: PluginDatabase,
  core: Pick<CoreServices, 'tasks' | 'projects'>,
  emit: GithubEmit,
  status: () => void,
) =>
  new Hono<AppEnv>().use(requireDevice).get('/', async (c) => {
    const task = await core.tasks.load(c.req.query('taskId') ?? '')
    const project = task?.pullNumber != null ? await core.projects.byId(task.projectId) : null
    if (task?.pullNumber == null || !project?.github) return respondError(c, 404, 'not_found')
    const label = `Pull request #${task.pullNumber}`
    const token = await githubToken(c)
    if (!token)
      return c.json({
        blocks: [
          {
            kind: 'status',
            label,
            state: "GitHub isn't connected",
            severity: 'warn',
            detail: "Connect GitHub in Acorn's Settings > Services to see this pull request.",
          },
        ],
      } satisfies BrowserPanelView)

    const { owner, name: repo } = project.github
    // The extension only hears this plugin through `term:status`, so a background refresh this read
    // started makes the panel read again. That read finds the mirror fresh and refreshes nothing.
    // Every refresh sends `pr-synced`, and `checks-changed` only rides with it, so one status a refresh.
    const read = await readPullDetail(
      db,
      { token, userId: ownerId(c), owner, repo, number: task.pullNumber },
      (verb, payload) => {
        emit(verb, payload)
        if (verb === 'pr-synced') status()
      },
    )
    if (!read.ok) return respondError(c, read.failure.status, read.failure.error, read.failure.detail)
    if (!read.value.pull) return respondError(c, 404, 'not_found')
    return c.json(pullPanelView(owner, repo, read.value))
  })

/** The panel for one pull request, from its mirrored detail. */
export function pullPanelView(owner: string, repo: string, detail: PullDetail): BrowserPanelView {
  const pull = detail.pull!
  const open = pull.state === 'open'
  const failed = detail.checks.filter((check) => checkFailed(check.status))
  const checkRank = (check: Check) => (checkFailed(check.status) ? 0 : checkPending(check.status) ? 1 : 2)
  // A stable sort keeps GitHub's order within each group, and the cut drops passing checks first.
  const checkRows = [...detail.checks]
    .sort((a, b) => checkRank(a) - checkRank(b))
    .slice(0, 64)
    .map((check) => ({
      label: check.name.slice(0, 80) || 'Unnamed check',
      state: words(check.status ?? 'pending'),
      severity: (['danger', 'pending', 'info'] as const)[checkRank(check)],
    }))
  const reviewRows = reviewerRows(detail)
  const conflicts = pull.mergeable === 'CONFLICTING' || pull.mergeStateStatus === 'DIRTY'
  const severity: Severity = !open
    ? 'info'
    : conflicts || failed.length
      ? 'danger'
      : checkRows.some((row) => row.severity === 'pending')
        ? 'pending'
        : reviewRows.some((row) => row.severity === 'warn')
          ? 'warn'
          : 'info'

  const unresolved = detail.threads.filter((thread) => !thread.resolved).length
  const detailLines = [
    pull.title,
    pull.headRef && pull.baseRef ? `${pull.headRef} → ${pull.baseRef}` : '',
    open ? mergeLine(pull, conflicts) : '',
    unresolved ? `${unresolved} unresolved review ${unresolved === 1 ? 'thread' : 'threads'}` : '',
    open && pull.autoMergeEnabled ? 'Auto-merge is on' : '',
  ].filter(Boolean)

  const url = `https://github.com/${owner}/${repo}/pull/${pull.number}`
  const links: Link[] = [
    { label: 'Pull request', url },
    { label: 'Checks', url: `${url}/checks` },
    ...failed.flatMap((check) =>
      check.url && check.url.length <= 2_048
        ? [{ label: check.name.slice(0, 40) || 'Failed check', url: check.url }]
        : [],
    ),
  ]

  const blocks: BrowserPanelBlock[] = [
    {
      kind: 'status',
      label: `Pull request #${pull.number}`,
      state: pull.state === 'merged' ? 'Merged' : !open ? 'Closed' : pull.draft ? 'Draft' : 'Open',
      severity,
      detail: detailLines.join('\n').slice(0, 2_000),
    },
  ]
  if (checkRows.length) blocks.push({ kind: 'rows', title: 'Checks', rows: checkRows })
  if (reviewRows.length) blocks.push({ kind: 'rows', title: 'Reviews', rows: reviewRows })
  blocks.push({ kind: 'links', title: 'Links', links: links.slice(0, 16) })
  return { blocks }
}

// Each reviewer's latest submitted review, then everyone requested who hasn't reviewed yet.
function reviewerRows(detail: PullDetail) {
  const latest = new Map<string, string>()
  for (const review of [...detail.reviews].sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0))) {
    const state = (review.state ?? '').toUpperCase()
    if (!review.author || !state || state === 'PENDING') continue
    // A comment after an approval or a change request doesn't withdraw it, as on GitHub.
    if (state === 'COMMENTED' && latest.has(review.author)) continue
    latest.set(review.author, state)
  }
  const rows: { label: string; state: string; severity: Severity }[] = [...latest].map(([author, state]) => ({
    label: author.slice(0, 80),
    state: words(state),
    severity: state === 'CHANGES_REQUESTED' ? 'warn' : 'info',
  }))
  for (const reviewer of detail.requestedReviewers)
    if (reviewer && !latest.has(reviewer))
      rows.push({ label: reviewer.slice(0, 80), state: 'requested', severity: 'pending' })
  return rows.slice(0, 64)
}

function mergeLine(pull: NonNullable<PullDetail['pull']>, conflicts: boolean): string {
  if (conflicts) return 'Has conflicts with the base branch'
  switch (pull.mergeStateStatus) {
    case 'BEHIND':
      return 'Behind the base branch'
    case 'BLOCKED':
      return 'Blocked by required checks or reviews'
    case 'UNSTABLE':
      return 'Some checks are failing'
    case 'CLEAN':
    case 'HAS_HOOKS':
      return 'Ready to merge'
    default:
      return ''
  }
}

// GitHub's IN_PROGRESS as "in progress", cut to a panel state's 40 characters.
const words = (value: string) => value.toLowerCase().replaceAll('_', ' ').slice(0, 40) || 'unknown'
