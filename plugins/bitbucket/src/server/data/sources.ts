import type { DataSourceQuery } from '@acorn/protocol/dataSources.ts'
import { formatPullRequestRef, pullRequestUrl } from '../../shared/pullRequestRef'
import { bbPages, repositoryPath } from '../bitbucketApi'
import { forkOf } from '../mirror/pullRequests'
import { pullRequestState, time } from '../mirror/vocabulary'
import { login, type BitbucketPullRequest, type BitbucketUser } from '../types'
import {
  pullRequestSourceDescription,
  reviewCommentSourceDescription,
  stepSourceDescription,
} from './sourceDescriptions'
import { createRepositorySourceHandler } from './repositorySource'

// Bitbucket's read sources over the repositories a panel names. Pull requests read two pages of 50 a
// repository, and steps the last few pipelines' steps: past that the read says it's incomplete.
const PULL_REQUEST_PAGES = 2
const PIPELINES = 5

export const createPullRequestSourceHandler = () =>
  createRepositorySourceHandler({
    description: pullRequestSourceDescription,
    read: async (session, repository, signal) => {
      // A list row leaves its reviewers out unless asked for them.
      const listed = await bbPages<BitbucketPullRequest & { reviewers?: BitbucketUser[]; created_on?: string }>(
        session,
        `${repositoryPath(repository)}/pullrequests?state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED&sort=-updated_on&pagelen=50&fields=%2Bvalues.reviewers`,
        PULL_REQUEST_PAGES,
        signal,
      )
      if (!listed.ok) throw new Error('bitbucket_unavailable')
      return {
        truncated: listed.value.capped,
        records: listed.value.values.map((pull) => {
          const url = pullRequestUrl(repository, pull.id)
          return {
            recordId: formatPullRequestRef(repository, pull.id),
            data: {
              repository,
              number: pull.id,
              title: pull.title,
              state: pullRequestState(pull.state),
              draft: pull.draft === true,
              author: login(pull.author),
              sourceBranch: pull.source.branch?.name ?? '',
              sourceRepository: forkOf(pull),
              targetBranch: pull.destination.branch?.name ?? '',
              reviewers: (pull.reviewers ?? []).flatMap((reviewer) => login(reviewer) ?? []),
              createdAt: time(pull.created_on) ?? 0,
              updatedAt: time(pull.updated_on) ?? 0,
              url,
            },
            display: { title: pull.title, url },
            action: { verb: 'openUrl' as const, url },
          }
        }),
      }
    },
  })

// Review comments live under pull requests, so a read lists a repository's pull requests and then each
// one's comments. This many pull requests a repository keeps that within a panel's time budget.
const COMMENTED_PULL_REQUESTS = 25

type Comment = {
  id: number
  user?: BitbucketUser | null
  created_on: string
  inline?: object | null
  parent?: { id: number } | null
  deleted?: boolean
  pending?: boolean
  resolution?: object | null
}

/** The latest lower bound a query sets on a comment's creation time, or null without one. A comment
 *  made after it is on a pull request updated after it, so only those need reading. */
function createdSince(query: DataSourceQuery): number | null {
  const predicate = query.predicate
  const bounds = (predicate?.kind === 'all' ? predicate.predicates : predicate ? [predicate] : []).flatMap((part) =>
    part.kind === 'comparison' &&
    part.left.address.from === 'item' &&
    part.left.address.pointer === '/createdAt' &&
    (part.operator === 'gt' || part.operator === 'gte') &&
    part.right?.address.from === 'literal' &&
    typeof part.right.address.value === 'number'
      ? [part.right.address.value]
      : [],
  )
  return bounds.length ? Math.max(...bounds) : null
}

export const createReviewCommentSourceHandler = () =>
  createRepositorySourceHandler({
    description: reviewCommentSourceDescription,
    read: async (session, repository, signal, query) => {
      const since = createdSince(query)
      const window =
        since === null
          ? ''
          : `&q=${encodeURIComponent(`updated_on >= ${new Date(since).toISOString().replace('Z', '+00:00')}`)}`
      const pulls = await bbPages<BitbucketPullRequest>(
        session,
        `${repositoryPath(repository)}/pullrequests?state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED&sort=-updated_on&pagelen=${COMMENTED_PULL_REQUESTS}${window}`,
        1,
        signal,
      )
      if (!pulls.ok) throw new Error('bitbucket_unavailable')
      let truncated = pulls.value.capped
      const records = []
      for (const pull of pulls.value.values) {
        const listed = await bbPages<Comment>(
          session,
          `${repositoryPath(repository)}/pullrequests/${pull.id}/comments?pagelen=100`,
          1,
          signal,
        )
        if (!listed.ok) throw new Error('bitbucket_unavailable')
        truncated ||= listed.value.capped
        // A deleted comment keeps its place in a thread, and a pending one is a draft only its author sees.
        const comments = listed.value.values.filter((comment) => !comment.deleted && !comment.pending)
        const byId = new Map(comments.map((comment) => [comment.id, comment]))
        // Bitbucket resolves a thread on its first comment.
        const threadOf = (comment: Comment) => {
          let root = comment
          for (let depth = 0; root.parent && byId.has(root.parent.id) && depth < comments.length; depth++)
            root = byId.get(root.parent.id)!
          return root
        }
        const pullUrl = pullRequestUrl(repository, pull.id)
        const title = `${formatPullRequestRef(repository, pull.id)}: ${pull.title}`
        const pullAuthor = login(pull.author)
        for (const comment of comments) {
          const author = login(comment.user)
          const thread = threadOf(comment)
          const url = `${pullUrl}#comment-${comment.id}`
          records.push({
            recordId: `${formatPullRequestRef(repository, pull.id)}:${comment.id}`,
            data: {
              id: String(comment.id),
              title,
              repository,
              number: pull.id,
              pullTitle: pull.title,
              pullUrl,
              author,
              authorIsPullAuthor: author !== null && author === pullAuthor,
              kind: comment.parent ? 'reply' : comment.inline ? 'inline' : 'conversation',
              reviewState: null,
              resolved: thread.resolution ? true : thread.inline ? false : null,
              createdAt: time(comment.created_on) ?? 0,
              url,
            },
            display: { title, url },
            // The pull request's address, which Acorn opens in its own pull request view when it can.
            action: { verb: 'openUrl' as const, url: pullUrl },
          })
        }
      }
      return { truncated, records }
    },
  })

type State = { name: string; result?: { name: string } | null }
type Pipeline = {
  uuid: string
  build_number: number
  state: State
  target?: { ref_name?: string | null } | null
  created_on?: string | null
}
type Step = {
  uuid: string
  name?: string | null
  state: State
  started_on?: string | null
  completed_on?: string | null
  duration_in_seconds?: number | null
}

/** A step's state in one word: its result once it finished, such as `successful` or `failed`, and
 *  `pending` or `in_progress` until then. */
const stepStatus = (state: State) => (state.result?.name ?? state.name).toLowerCase()

// Steps of the newest pipelines, one request for the pipelines and one for each one's steps. Bitbucket
// re-runs a whole pipeline or its failed steps, never one step, so a row offers no re-run.
export const createStepSourceHandler = () =>
  createRepositorySourceHandler({
    description: stepSourceDescription,
    read: async (session, repository, signal) => {
      const pipelines = await bbPages<Pipeline>(
        session,
        `${repositoryPath(repository)}/pipelines/?sort=-created_on&pagelen=${PIPELINES}`,
        1,
        signal,
      )
      if (!pipelines.ok) throw new Error('bitbucket_unavailable')
      const records = []
      for (const pipeline of pipelines.value.values) {
        const steps = await bbPages<Step>(
          session,
          `${repositoryPath(repository)}/pipelines/${encodeURIComponent(pipeline.uuid)}/steps/?pagelen=100`,
          1,
          signal,
        )
        if (!steps.ok) throw new Error('bitbucket_unavailable')
        for (const step of steps.value.values) {
          const url = `https://bitbucket.org/${repository}/pipelines/results/${pipeline.build_number}/steps/${encodeURIComponent(step.uuid)}`
          const name = step.name || 'Step'
          records.push({
            recordId: `${repository}:${step.uuid}`,
            data: {
              repository,
              pipelineNumber: pipeline.build_number,
              name,
              status: stepStatus(step.state),
              branch: pipeline.target?.ref_name ?? null,
              startedAt: time(step.started_on ?? pipeline.created_on) ?? 0,
              finishedAt: time(step.completed_on),
              durationMs: step.duration_in_seconds == null ? null : Math.round(step.duration_in_seconds * 1000),
              url,
            },
            display: { title: name, url },
            action: { verb: 'openUrl' as const, url },
          })
        }
      }
      return { truncated: pipelines.value.capped, records }
    },
  })
