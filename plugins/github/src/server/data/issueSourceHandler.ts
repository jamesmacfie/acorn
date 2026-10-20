import { z } from 'zod'
import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import type { DataSourcePage, DataSourceQuery } from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS, parseDataValue } from '@acorn/protocol/dataValues.ts'
import { issueSourceDescription } from '../../shared/issueSourceDescription'
import { comparisons, dateQualifier, repositoryQualifiers } from './pullQuery'
import { githubData } from './pullRead'
import { createSearchSourceHandler } from './searchSourceHandler'

export function createIssueSourceHandler(): PluginFetchHandler {
  return createSearchSourceHandler({
    description: issueSourceDescription,
    read: (token, query, connectionId, signal) => readIssueSelection(token, issueSearch(query), connectionId, signal),
  })
}

const LOGIN = /^[\w-]+(?:\[bot\])?$/
const DATE_QUALIFIERS: Record<string, string> = {
  '/createdAt': 'created',
  '/updatedAt': 'updated',
  '/closedAt': 'closed',
}

/** Qualifiers only narrow candidates. Exact typed predicates are checked after full exhaustion. */
function issueSearch(query: DataSourceQuery): string {
  const parts = ['is:issue', ...repositoryQualifiers(query)]
  for (const filter of comparisons(query.predicate)) {
    const left = filter.left.address
    const right = filter.right?.address
    if (left.from !== 'item' || right?.from !== 'literal') throw new Error('invalid_operand')
    const field = issueSourceDescription.fields.find((field) => field.pointer === left.pointer)
    if (!field?.query?.operators.includes(filter.operator)) throw new Error('unsupported_filter')
    const value = right.value
    switch (left.pointer) {
      case '/state':
        if (value !== 'open' && value !== 'closed') throw new Error('invalid_state')
        parts.push(`is:${value}`)
        break
      case '/author':
      case '/assignees':
        if (typeof value !== 'string' || !LOGIN.test(value)) throw new Error('invalid_login')
        parts.push(`${left.pointer === '/author' ? 'author' : 'assignee'}:${value}`)
        break
      case '/labels':
        if (typeof value !== 'string') throw new Error('invalid_label')
        // A quote or backslash could end GitHub's quoted value early, so that label isn't narrowed.
        if (!/["\\]/.test(value)) parts.push(`label:"${value}"`)
        break
      default:
        parts.push(dateQualifier(DATE_QUALIFIERS[left.pointer]!, filter.operator, value))
    }
  }
  for (const sort of query.sort) {
    if (!issueSourceDescription.fields.find((field) => field.pointer === sort.pointer)?.query?.sortable)
      throw new Error('unsupported_sort')
  }
  return parts.join(' ')
}

const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })
const timestamp = z
  .string()
  .transform((value) => Date.parse(value))
  .refine(Number.isFinite)
const issue = z.object({
  __typename: z.literal('Issue'),
  id: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string().url(),
  state: z.enum(['OPEN', 'CLOSED']),
  stateReason: z.string().nullable(),
  author: z.object({ login: z.string() }).nullable(),
  repository: z.object({ nameWithOwner: z.string() }),
  milestone: z.object({ title: z.string() }).nullable(),
  comments: z.object({ totalCount: z.number().int().nonnegative() }),
  assignees: z.object({ nodes: z.array(z.object({ login: z.string() })), pageInfo }),
  labels: z.object({ nodes: z.array(z.object({ name: z.string() })), pageInfo }),
  createdAt: timestamp,
  updatedAt: timestamp,
  closedAt: timestamp.nullable(),
})
// An issue search can match pull requests too, which the `is:issue` qualifier keeps out. A pull
// request that slips through still parses, and the read skips it.
const searchPage = z.object({
  search: z.object({
    issueCount: z.number().int().nonnegative(),
    nodes: z.array(z.discriminatedUnion('__typename', [issue, z.object({ __typename: z.literal('PullRequest') })])),
    pageInfo,
  }),
})
// GitHub's search returns at most 1,000 matches, which is 10 pages of 100.
const SEARCH_PAGE_SIZE = 100
const SEARCH_PAGES = 10
const SEARCH = `query AcornIssueSource($q: String!, $first: Int!, $after: String) {
  search(query: $q, type: ISSUE, first: $first, after: $after) {
    issueCount pageInfo { hasNextPage endCursor }
    nodes { __typename ... on Issue {
      id number title url state stateReason createdAt updatedAt closedAt
      author { login } repository { nameWithOwner } milestone { title } comments { totalCount }
      assignees(first: 100) { pageInfo { hasNextPage endCursor } nodes { login } }
      labels(first: 100) { pageInfo { hasNextPage endCursor } nodes { name } }
    } }
  }
}`
const CLOSE_REASONS = new Set(['COMPLETED', 'NOT_PLANNED', 'DUPLICATE'])

async function readIssueSelection(
  token: string,
  q: string,
  connectionId: string,
  signal: AbortSignal,
): Promise<DataSourcePage> {
  const records: DataSourcePage['records'] = []
  const seen = new Set<string>()
  const cursors = new Set<string>()
  let after: string | null = null
  let bytes = 0
  const result = (completeness: DataSourcePage['completeness']): DataSourcePage => ({
    records,
    completeness,
    revision: issueSourceDescription.revision,
    readTime: Date.now(),
  })
  for (let page = 0; page < SEARCH_PAGES; page++) {
    const response: z.infer<typeof searchPage> = await githubData(
      token,
      SEARCH,
      { q, first: SEARCH_PAGE_SIZE, after },
      searchPage,
      signal,
    )
    const search: z.infer<typeof searchPage>['search'] = response.search
    if (search.issueCount > SEARCH_PAGE_SIZE * SEARCH_PAGES)
      return result({ kind: 'incomplete', cause: 'upstream-cap' })
    for (const node of search.nodes) {
      if (node.__typename !== 'Issue') continue
      if (seen.has(node.id)) throw new Error('github_duplicate_record')
      seen.add(node.id)
      if (node.assignees.pageInfo.hasNextPage || node.labels.pageInfo.hasNextPage)
        return result({ kind: 'incomplete', cause: 'upstream-cap' })
      const data = {
        id: node.id,
        number: node.number,
        title: node.title,
        repository: node.repository.nameWithOwner,
        url: node.url,
        state: node.state.toLowerCase(),
        // An open issue's reason is null or REOPENED. Only a closed one says why it closed.
        closeReason:
          node.state === 'CLOSED' && node.stateReason && CLOSE_REASONS.has(node.stateReason)
            ? node.stateReason.toLowerCase()
            : null,
        author: node.author?.login ?? null,
        assignees: node.assignees.nodes.map((item) => item.login),
        labels: node.labels.nodes.map((item) => item.name),
        milestone: node.milestone?.title ?? null,
        comments: node.comments.totalCount,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        closedAt: node.closedAt,
      }
      parseDataValue(data, DATA_LIMITS.recordBytes)
      bytes += Buffer.byteLength(JSON.stringify(data))
      if (bytes > DATA_LIMITS.selectionBytes) return result({ kind: 'incomplete', cause: 'host-budget' })
      records.push({
        recordId: node.id,
        data,
        display: { title: node.title, url: node.url },
        // Acorn has no issue view of its own, so a press opens the issue on GitHub.
        action: { verb: 'openUrl', url: node.url },
      })
    }
    if (!search.pageInfo.hasNextPage) return result({ kind: 'complete' })
    const next: string | null = search.pageInfo.endCursor
    if (!next || cursors.has(next)) throw new Error('github_invalid_cursor')
    cursors.add(next)
    after = next
  }
  return result({ kind: 'incomplete', cause: 'upstream-cap' })
}
