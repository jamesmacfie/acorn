import { z } from 'zod'
import type { DataSourcePage } from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS, parseDataValue } from '@acorn/protocol/dataValues.ts'
import { pullSourceDescription } from '../../shared/pullSource'
import { ghGraphQL, ghGraphQLResult } from '../githubApi'

const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })
const timestamp = z.string().transform(value => Date.parse(value)).refine(Number.isFinite)
const pull = z.object({
  id: z.string().min(1), number: z.number().int().positive(), title: z.string(), url: z.string().url(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']), isDraft: z.boolean(),
  author: z.object({ login: z.string() }).nullable(), repository: z.object({ nameWithOwner: z.string() }),
  createdAt: timestamp, updatedAt: timestamp, closedAt: timestamp.nullable(), mergedAt: timestamp.nullable(),
  mergeable: z.string(), mergeStateStatus: z.string(), autoMergeRequest: z.object({ mergeMethod: z.string() }).nullable(),
  reviewDecision: z.string().nullable(),
  latestCommit: z.object({ nodes: z.array(z.object({ commit: z.object({ committedDate: timestamp,
    statusCheckRollup: z.object({ state: z.string(), contexts: z.object({ pageInfo: z.object({ hasNextPage: z.boolean() }),
    nodes: z.array(z.union([
      z.object({ __typename: z.literal('CheckRun'), status: z.string(), conclusion: z.string().nullable() }),
      z.object({ __typename: z.literal('StatusContext'), state: z.string() }),
    ])),
  }) }).nullable() }) })) }),
  labels: z.object({ nodes: z.array(z.object({ name: z.string() })), pageInfo }),
  reviewRequests: z.object({ nodes: z.array(z.object({ requestedReviewer: z.union([
    z.object({ __typename: z.literal('User'), login: z.string() }),
    z.object({ __typename: z.literal('Team'), name: z.string(), slug: z.string() }),
  ]).nullable() })), pageInfo }),
  latestComment: z.object({ nodes: z.array(z.object({ createdAt: timestamp })) }),
  latestReview: z.object({ nodes: z.array(z.object({ submittedAt: timestamp.nullable() })) }),
  reviewRequestEvents: z.object({ pageInfo: z.object({ hasPreviousPage: z.boolean() }), nodes: z.array(z.object({
    createdAt: timestamp, requestedReviewer: z.union([
      z.object({ __typename: z.literal('User'), login: z.string() }),
      z.object({ __typename: z.literal('Team'), name: z.string(), slug: z.string() }),
    ]).nullable(),
  })) }),
})
const searchPage = z.object({ search: z.object({ issueCount: z.number().int().nonnegative(), nodes: z.array(pull), pageInfo }) })
const SEARCH = `query AcornPullSource($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    issueCount pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      id number title url state isDraft createdAt updatedAt closedAt mergedAt
      author { login } repository { nameWithOwner }
      mergeable mergeStateStatus autoMergeRequest { mergeMethod }
      reviewDecision
      labels(first: 100) { pageInfo { hasNextPage endCursor } nodes { name } }
      reviewRequests(first: 100) { pageInfo { hasNextPage endCursor } nodes { requestedReviewer { __typename ... on User { login } ... on Team { name slug } } } }
      latestCommit: commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state
        contexts(first: 20) { pageInfo { hasNextPage } nodes {
          __typename ... on CheckRun { status conclusion } ... on StatusContext { state }
        } }
      } } } }
      latestComment: comments(last: 1) { nodes { createdAt } }
      latestReview: reviews(last: 1) { nodes { submittedAt } }
      reviewRequestEvents: timelineItems(last: 20, itemTypes: [REVIEW_REQUESTED_EVENT]) {
        pageInfo { hasPreviousPage } nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer {
          __typename ... on User { login } ... on Team { name slug }
        } } }
      }
    } }
  }
}`

export async function githubData<T>(token: string, query: string, variables: Record<string, unknown>, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  const result = await ghGraphQLResult<unknown>(await ghGraphQL(token, query, variables, signal))
  if (!result.ok) throw new Error(result.kind === 'http' ? result.failure.error : 'github_query_failed')
  return schema.parse(result.data)
}

export async function readPullSelection(token: string, q: string, signal: AbortSignal): Promise<DataSourcePage> {
  const records: DataSourcePage['records'] = []
  const seen = new Set<string>()
  const cursors = new Set<string>()
  let after: string | null = null
  let bytes = 0
  const result = (completeness: DataSourcePage['completeness']): DataSourcePage => ({ records, completeness, revision: pullSourceDescription.revision, readTime: Date.now() })
  for (let page = 0; page < 10; page++) {
    const response: z.infer<typeof searchPage> = await githubData(token, SEARCH, { q, after }, searchPage, signal)
    const search: z.infer<typeof searchPage>['search'] = response.search
    if (search.issueCount > 1000) return result({ kind: 'incomplete', cause: 'upstream-cap' })
    for (const node of search.nodes) {
      if (seen.has(node.id)) throw new Error('github_duplicate_record')
      seen.add(node.id)
      const statusCheckRollup = node.latestCommit.nodes[0]?.commit.statusCheckRollup ?? null
      if (node.labels.pageInfo.hasNextPage || node.reviewRequests.pageInfo.hasNextPage
        || node.reviewRequestEvents.pageInfo.hasPreviousPage || statusCheckRollup?.contexts.pageInfo.hasNextPage) {
        return result({ kind: 'incomplete', cause: 'upstream-cap' })
      }
      const { author, repository, isDraft, state, autoMergeRequest, labels, reviewRequests,
        latestCommit, latestComment, latestReview, reviewRequestEvents, ...fields } = node
      const activity = [node.updatedAt, ...latestCommit.nodes.map(item => item.commit.committedDate),
        ...latestComment.nodes.map(item => item.createdAt), ...latestReview.nodes.flatMap(item => item.submittedAt === null ? [] : [item.submittedAt])]
      const requestTimes = new Map<string, number>()
      for (const event of reviewRequestEvents.nodes) {
        const reviewer = event.requestedReviewer
        if (reviewer) requestTimes.set(`${reviewer.__typename}:${reviewer.__typename === 'Team' ? reviewer.slug : reviewer.login}`, event.createdAt)
      }
      const checkStatuses = statusCheckRollup?.contexts.nodes.map(context => context.__typename === 'StatusContext'
        ? context.state : context.status !== 'COMPLETED' ? 'PENDING' : context.conclusion ?? 'UNKNOWN') ?? []
      const data = { ...fields, author: author?.login ?? null, repository: repository.nameWithOwner,
        draft: isDraft, state: state.toLowerCase(), autoMergeEnabled: autoMergeRequest !== null,
        checks: statusCheckRollup?.state ?? 'EXPECTED',
        checkStatuses,
        labels: labels.nodes.map(item => item.name),
        requestedReviewers: reviewRequests.nodes.flatMap(item => item.requestedReviewer?.__typename === 'User' ? [item.requestedReviewer.login] : []),
        requestedTeams: reviewRequests.nodes.flatMap(item => item.requestedReviewer?.__typename === 'Team' ? [item.requestedReviewer.slug] : []),
        reviewRequests: reviewRequests.nodes.flatMap(item => item.requestedReviewer ? [{ kind: item.requestedReviewer.__typename.toLowerCase(),
          name: item.requestedReviewer.__typename === 'Team' ? item.requestedReviewer.slug : item.requestedReviewer.login,
          requestedAt: requestTimes.get(`${item.requestedReviewer.__typename}:${item.requestedReviewer.__typename === 'Team' ? item.requestedReviewer.slug : item.requestedReviewer.login}`) ?? null }] : []),
        reviewRequestedFromViewer: q.includes('-review-requested:@me') ? false
          : q.includes('review-requested:@me') ? true : null,
        lastActivityAt: Math.max(...activity),
      }
      parseDataValue(data, DATA_LIMITS.recordBytes)
      bytes += Buffer.byteLength(JSON.stringify(data))
      if (bytes > DATA_LIMITS.selectionBytes) return result({ kind: 'incomplete', cause: 'host-budget' })
      records.push({ recordId: node.id, data, display: { title: node.title, url: node.url }, action: { verb: 'openUrl', url: node.url },
        writableFields: state === 'MERGED' ? [] : ['/state'],
        target: { kind: 'github.pull-request', item: `${repository.nameWithOwner}#${node.number}` } })
    }
    if (!search.pageInfo.hasNextPage) return result({ kind: 'complete' })
    const next: string | null = search.pageInfo.endCursor
    if (!next || cursors.has(next)) throw new Error('github_invalid_cursor')
    cursors.add(next)
    after = next
  }
  return result({ kind: 'incomplete', cause: 'upstream-cap' })
}

const REPOSITORIES = `query AcornSourceRepositories($first: Int!, $after: String) {
  viewer { repositories(first: $first, after: $after, affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER],
    ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], orderBy: {field: NAME, direction: ASC}) {
    nodes { nameWithOwner } pageInfo { hasNextPage endCursor }
  } }
}`
const repositoriesPage = z.object({ viewer: z.object({ repositories: z.object({ nodes: z.array(z.object({ nameWithOwner: z.string() })), pageInfo }) }) })

export async function readRepositoryOptions(token: string, input: { pageSize: number; cursor?: string; search: string }, signal: AbortSignal) {
  const { viewer: { repositories } } = await githubData(token, REPOSITORIES,
    { first: input.pageSize, after: input.cursor ?? null }, repositoriesPage, signal)
  if (repositories.pageInfo.hasNextPage && !repositories.pageInfo.endCursor) throw new Error('github_invalid_cursor')
  return {
    options: repositories.nodes.filter(repo => repo.nameWithOwner.toLowerCase().includes(input.search.toLowerCase()))
      .map(repo => ({ id: repo.nameWithOwner, label: repo.nameWithOwner.slice(0, 80) })),
    exhausted: !repositories.pageInfo.hasNextPage,
    ...(repositories.pageInfo.hasNextPage ? { nextCursor: repositories.pageInfo.endCursor! } : {}),
  }
}

const VIEWER = 'query AcornSourceViewer { viewer { id login name email } }'
const viewerSchema = z.object({ viewer: z.object({ id: z.string(), login: z.string(), name: z.string().nullable(), email: z.string().nullable() }) })
export async function readViewerIdentity(token: string, signal: AbortSignal) {
  const { viewer } = await githubData(token, VIEWER, {}, viewerSchema, signal)
  return { id: viewer.id, login: viewer.login, ...(viewer.name ? { name: viewer.name } : {}),
    ...(viewer.email ? { email: viewer.email } : {}) }
}
