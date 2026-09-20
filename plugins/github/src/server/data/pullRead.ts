import { z } from 'zod'
import type { DataSourcePage } from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS, parseDataValue } from '@acorn/protocol/dataValues.ts'
import { ghGraphQL, ghGraphQLResult } from '../githubApi'

const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })
const timestamp = z.string().transform(value => Date.parse(value)).refine(Number.isFinite)
const pull = z.object({
  id: z.string().min(1), number: z.number().int().positive(), title: z.string(), url: z.string().url(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']), isDraft: z.boolean(),
  author: z.object({ login: z.string() }).nullable(), repository: z.object({ nameWithOwner: z.string() }),
  createdAt: timestamp, updatedAt: timestamp, closedAt: timestamp.nullable(), mergedAt: timestamp.nullable(),
  mergeable: z.string(), mergeStateStatus: z.string(), autoMergeRequest: z.object({ mergeMethod: z.string() }).nullable(),
})
const searchPage = z.object({ search: z.object({ issueCount: z.number().int().nonnegative(), nodes: z.array(pull), pageInfo }) })
const SEARCH = `query AcornPullSource($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    issueCount pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      id number title url state isDraft createdAt updatedAt closedAt mergedAt
      author { login } repository { nameWithOwner }
      mergeable mergeStateStatus autoMergeRequest { mergeMethod }
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
  const result = (completeness: DataSourcePage['completeness']): DataSourcePage => ({ records, completeness, revision: '1', readTime: Date.now() })
  for (let page = 0; page < 10; page++) {
    const response: z.infer<typeof searchPage> = await githubData(token, SEARCH, { q, after }, searchPage, signal)
    const search: z.infer<typeof searchPage>['search'] = response.search
    if (search.issueCount > 1000) return result({ kind: 'incomplete', cause: 'upstream-cap' })
    for (const node of search.nodes) {
      if (seen.has(node.id)) throw new Error('github_duplicate_record')
      seen.add(node.id)
      const { author, repository, isDraft, state, autoMergeRequest, ...fields } = node
      const data = { ...fields, author: author?.login ?? null, repository: repository.nameWithOwner,
        draft: isDraft, state: state.toLowerCase(), autoMergeEnabled: autoMergeRequest !== null }
      parseDataValue(data, DATA_LIMITS.recordBytes)
      bytes += Buffer.byteLength(JSON.stringify(data))
      if (bytes > DATA_LIMITS.selectionBytes) return result({ kind: 'incomplete', cause: 'host-budget' })
      records.push({ recordId: node.id, data, display: { title: node.title, url: node.url }, action: { verb: 'openUrl', url: node.url } })
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
