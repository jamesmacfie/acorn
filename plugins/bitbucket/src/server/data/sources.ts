import { formatPullRequestRef, pullRequestUrl } from '../../shared/pullRequestRef'
import { bbPages, repositoryPath } from '../bitbucketApi'
import { forkOf } from '../mirror/pullRequests'
import { pullRequestState, time } from '../mirror/vocabulary'
import { login, type BitbucketPullRequest, type BitbucketUser } from '../types'
import { pullRequestSourceDescription, stepSourceDescription } from './sourceDescriptions'
import { createRepositorySourceHandler } from './repositorySource'

// Bitbucket's two read sources over the repositories a panel names. Pull requests read two pages of 50
// a repository, and steps the last few pipelines' steps: past that the read says it's incomplete.
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
