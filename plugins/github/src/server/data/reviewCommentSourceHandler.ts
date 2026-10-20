import { z } from 'zod'
import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import type { DataSourcePage, DataSourceQuery } from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS, parseDataValue } from '@acorn/protocol/dataValues.ts'
import { reviewCommentSourceDescription } from '../../shared/reviewCommentSourceDescription'
import { comparisons, dateQualifier, repositoryQualifiers } from './pullQuery'
import { githubData } from './pullRead'
import { createSearchSourceHandler } from './searchSourceHandler'

export function createReviewCommentSourceHandler(): PluginFetchHandler {
  return createSearchSourceHandler({
    description: reviewCommentSourceDescription,
    read: (token, query, _connectionId, signal) => readReviewComments(token, reviewCommentSearch(query), signal),
    partial: true,
  })
}

/** The pull requests whose comments a query can match. Every typed predicate is checked again after the
 *  read, because only a lower bound on Created narrows which pull requests to read. */
function reviewCommentSearch(query: DataSourceQuery): string {
  // Newest first, so a read the cap stops keeps the most recent comments.
  const parts = ['is:pr', ...repositoryQualifiers(query), 'sort:updated-desc']
  for (const filter of comparisons(query.predicate)) {
    const left = filter.left.address
    if (left.from !== 'item' || filter.right?.address.from !== 'literal') throw new Error('invalid_operand')
    const field = reviewCommentSourceDescription.fields.find((field) => field.pointer === left.pointer)
    if (!field?.query?.operators.includes(filter.operator)) throw new Error('unsupported_filter')
    // A comment made after a time is on a pull request updated after it.
    if (left.pointer === '/createdAt' && (filter.operator === 'gt' || filter.operator === 'gte'))
      parts.push(dateQualifier('updated', filter.operator, filter.right.address.value))
  }
  for (const sort of query.sort) {
    if (!reviewCommentSourceDescription.fields.find((field) => field.pointer === sort.pointer)?.query?.sortable)
      throw new Error('unsupported_sort')
  }
  return parts.join(' ')
}

const pageInfo = z.object({ hasNextPage: z.boolean() })
const timestamp = z
  .string()
  .transform((value) => Date.parse(value))
  .refine(Number.isFinite)
const author = z.object({ login: z.string() }).nullable()
const REVIEW_STATE = z.enum(['PENDING', 'COMMENTED', 'APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'])
const pull = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string().url(),
  author,
  repository: z.object({ nameWithOwner: z.string() }),
  comments: z.object({
    pageInfo,
    nodes: z.array(z.object({ id: z.string(), url: z.string().url(), createdAt: timestamp, author })),
  }),
  reviews: z.object({
    pageInfo,
    nodes: z.array(
      z.object({
        id: z.string(),
        url: z.string().url(),
        state: REVIEW_STATE,
        submittedAt: timestamp.nullable(),
        author,
        // Read only to tell an empty review apart. It never reaches a record.
        body: z.string(),
      }),
    ),
  }),
  reviewThreads: z.object({
    pageInfo,
    nodes: z.array(
      z.object({
        isResolved: z.boolean(),
        comments: z.object({
          pageInfo,
          nodes: z.array(
            z.object({
              id: z.string(),
              url: z.string().url(),
              createdAt: timestamp,
              author,
              replyTo: z.object({ id: z.string() }).nullable(),
              pullRequestReview: z.object({ state: REVIEW_STATE }).nullable(),
            }),
          ),
        }),
      }),
    ),
  }),
})
const searchPage = z.object({
  search: z.object({
    issueCount: z.number().int().nonnegative(),
    nodes: z.array(pull),
    pageInfo: pageInfo.extend({ endCursor: z.string().nullable() }),
  }),
})
// Each pull request brings up to 5,200 comments, so a page holds 20 to stay inside GitHub's query
// time limit, and five pages cap the read at the 100 most recently updated pull requests.
const SEARCH_PAGE_SIZE = 20
const SEARCH_PAGES = 5
const SEARCH = `query AcornReviewCommentSource($q: String!, $first: Int!, $after: String) {
  search(query: $q, type: ISSUE, first: $first, after: $after) {
    issueCount pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      id number title url author { login } repository { nameWithOwner }
      comments(first: 100) { pageInfo { hasNextPage } nodes { id url createdAt author { login } } }
      reviews(first: 100) { pageInfo { hasNextPage } nodes { id url state submittedAt author { login } body } }
      reviewThreads(first: 100) { pageInfo { hasNextPage } nodes { isResolved
        comments(first: 50) { pageInfo { hasNextPage } nodes {
          id url createdAt author { login } replyTo { id } pullRequestReview { state }
        } }
      } }
    } }
  }
}`

type Comment = {
  id: string
  url: string
  createdAt: number
  author: string | null
  kind: 'inline' | 'reply' | 'summary' | 'conversation'
  reviewState: z.infer<typeof REVIEW_STATE> | null
  resolved: boolean | null
}

/** A pull request's comments, leaving out a pending review only its author can see, and a review with
 *  no text that only carries its inline comments, which are records of their own. */
function commentsOf(node: z.infer<typeof pull>): Comment[] {
  return [
    ...node.comments.nodes.map((comment) => ({
      ...comment,
      author: comment.author?.login ?? null,
      kind: 'conversation' as const,
      reviewState: null,
      resolved: null,
    })),
    ...node.reviews.nodes.flatMap((review) =>
      review.state === 'PENDING' || review.submittedAt === null || (review.state === 'COMMENTED' && !review.body)
        ? []
        : [
            {
              id: review.id,
              url: review.url,
              createdAt: review.submittedAt,
              author: review.author?.login ?? null,
              kind: 'summary' as const,
              reviewState: review.state,
              resolved: null,
            },
          ],
    ),
    ...node.reviewThreads.nodes.flatMap((thread) =>
      thread.comments.nodes.flatMap((comment) =>
        comment.pullRequestReview?.state === 'PENDING'
          ? []
          : [
              {
                id: comment.id,
                url: comment.url,
                createdAt: comment.createdAt,
                author: comment.author?.login ?? null,
                kind: comment.replyTo ? ('reply' as const) : ('inline' as const),
                reviewState: comment.pullRequestReview?.state ?? null,
                resolved: thread.isResolved,
              },
            ],
      ),
    ),
  ]
}

const capped = (node: z.infer<typeof pull>) =>
  node.comments.pageInfo.hasNextPage ||
  node.reviews.pageInfo.hasNextPage ||
  node.reviewThreads.pageInfo.hasNextPage ||
  node.reviewThreads.nodes.some((thread) => thread.comments.pageInfo.hasNextPage)

async function readReviewComments(token: string, q: string, signal: AbortSignal): Promise<DataSourcePage> {
  const records: DataSourcePage['records'] = []
  const seen = new Set<string>()
  const cursors = new Set<string>()
  let after: string | null = null
  let bytes = 0
  let truncated = false
  const result = (completeness: DataSourcePage['completeness']): DataSourcePage => ({
    records,
    completeness,
    revision: reviewCommentSourceDescription.revision,
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
    for (const node of search.nodes) {
      truncated ||= capped(node)
      const repository = node.repository.nameWithOwner
      const pullAuthor = node.author?.login ?? null
      for (const comment of commentsOf(node)) {
        if (seen.has(comment.id)) throw new Error('github_duplicate_record')
        seen.add(comment.id)
        const title = `${repository}#${node.number}: ${node.title}`
        const data = {
          id: comment.id,
          title,
          repository,
          number: node.number,
          pullTitle: node.title,
          pullUrl: node.url,
          author: comment.author,
          authorIsPullAuthor: comment.author !== null && comment.author === pullAuthor,
          kind: comment.kind,
          reviewState: comment.reviewState?.toLowerCase() ?? null,
          resolved: comment.resolved,
          createdAt: comment.createdAt,
          url: comment.url,
        }
        parseDataValue(data, DATA_LIMITS.recordBytes)
        bytes += Buffer.byteLength(JSON.stringify(data))
        if (bytes > DATA_LIMITS.selectionBytes) return result({ kind: 'incomplete', cause: 'host-budget' })
        records.push({
          recordId: comment.id,
          data,
          display: { title, url: comment.url },
          // The pull request's address, which Acorn opens in its own pull request view when it can.
          action: { verb: 'openUrl', url: node.url },
        })
      }
    }
    if (!search.pageInfo.hasNextPage)
      return result(truncated ? { kind: 'incomplete', cause: 'upstream-cap' } : { kind: 'complete' })
    const next: string | null = search.pageInfo.endCursor
    if (!next || cursors.has(next)) throw new Error('github_invalid_cursor')
    cursors.add(next)
    after = next
  }
  return result({ kind: 'incomplete', cause: 'upstream-cap' })
}
