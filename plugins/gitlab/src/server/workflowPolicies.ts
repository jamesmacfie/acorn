// The two workflow policies this plugin contributes, `gitlab:ci-settled` and `gitlab:review-received`
// (docs/workflows/step-kinds.md § Gate policies). `checks-green`, `ci-loop` and `review-received` ask a
// GitLab task's code host for them.
//
// Each poll reads the task's merge request from GitLab first, because the mirror otherwise refreshes
// only when somebody opens it, and a run nobody watches would read a copy older than the agent's push.
import type { CoreServices, PluginDatabase, StoredConnection } from '@acorn/plugin-api/node'
import type { CiSettledValue, PolicyContribution, PolicyVerdict } from '@acorn/plugin-workflows/contract/extensions.ts'
import { GITLAB_PROVIDER } from './gitlabApi'
import {
  mirroredMergeRequest,
  pipelineShaOf,
  readDetail,
  refreshMergeRequest,
  reviewActivitySince,
  type MirrorKey,
} from './mirror/detail'
import { checkFailed, checkPending } from './mirror/vocabulary'
import { taskMergeRequest } from './taskMergeRequest'
import { ciSettledDescription, reviewReceivedDescription, validateReviewReceived } from './policyDescriptions'
import type { GitlabEmit } from './events'

type PolicyCore = Pick<CoreServices, 'tasks' | 'projects' | 'identity'>
type ProviderAccess = {
  withConnection<T>(
    userId: string,
    providerId: string,
    visit: (connection: StoredConnection, secret: string) => Promise<T | undefined>,
  ): Promise<T | undefined>
}

const NO_MERGE_REQUEST: PolicyVerdict = {
  verdict: 'fail',
  detail: 'This task has no merge request in a GitLab project Acorn has listed.',
}

export function gitlabWorkflowPolicies(
  db: PluginDatabase,
  core: PolicyCore,
  providers: ProviderAccess,
  emit: GitlabEmit,
): { ciSettled: PolicyContribution; reviewReceived: PolicyContribution } {
  /** The task's merge request, read again from GitLab. A throw is a failed poll, which the gate retries. */
  async function refreshed(taskId: string): Promise<MirrorKey | { verdict: PolicyVerdict }> {
    const key = await taskMergeRequest(db, core, core.identity.active(), taskId)
    if (!key) return { verdict: NO_MERGE_REQUEST }
    const result = await providers.withConnection(key.userId, GITLAB_PROVIDER, (_connection, token) =>
      refreshMergeRequest({ token }, db, key, emit),
    )
    if (!result) throw new Error('GitLab is not connected.')
    if (!result.ok) throw new Error(`GitLab refresh failed: ${result.failure.detail?.[0] ?? result.failure.error}`)
    return key
  }

  const ciSettled: PolicyContribution = {
    describe: ciSettledDescription,
    evaluate: async (ctx) => {
      const key = await refreshed(ctx.taskId)
      if ('verdict' in key) return key.verdict
      const [detail, row] = await Promise.all([readDetail(db, key), mirroredMergeRequest(db, key)])
      if (!detail) return NO_MERGE_REQUEST
      const pipelineSha = await pipelineShaOf(db, key)
      if (row?.headSha && pipelineSha && pipelineSha !== row.headSha)
        return { verdict: 'wait', detail: 'The pipeline is still for an older commit.' }
      const checks = detail.checks
      if (!checks.length)
        return ctx.with.missing === 'wait'
          ? { verdict: 'wait', detail: 'The merge request has no pipeline jobs yet.' }
          : { verdict: 'fail', detail: 'The merge request has no pipeline jobs.' }
      const value: CiSettledValue = {
        failing: checks
          .filter((check) => checkFailed(check.status))
          .map(({ name, status, url }) => ({ name, status, url })),
        pending: checks.filter((check) => checkPending(check.status)).map((check) => check.name),
        total: checks.length,
      }
      // Every job finishes before an answer, so a fix turn sees the whole list of failures.
      if (value.pending.length) {
        const finished = value.total - value.pending.length
        return { verdict: 'wait', detail: `Jobs running: ${finished} of ${value.total} finished.`, value }
      }
      if (value.failing.length) {
        const names = value.failing.map((check) => check.name).join(', ')
        return { verdict: 'fail', detail: `${value.failing.length} of ${value.total} jobs failed: ${names}`, value }
      }
      return { verdict: 'pass', detail: `All ${value.total} jobs passed.`, value }
    },
  }

  const reviewReceived: PolicyContribution = {
    describe: reviewReceivedDescription,
    validate: validateReviewReceived,
    evaluate: async (ctx) => {
      const key = await refreshed(ctx.taskId)
      if ('verdict' in key) return key.verdict
      const found = await reviewActivitySince(db, key, ctx.since, { includeBots: ctx.with.include_bots === true })
      if (!found) return NO_MERGE_REQUEST
      if (found.state !== 'open') return { verdict: 'fail', detail: `The merge request was ${found.state}.` }
      if (!found.activity.length) return { verdict: 'wait', detail: 'No review yet.' }
      const reviewers = [...new Set(found.activity.map((item) => item.author ?? 'someone'))].join(', ')
      return { verdict: 'pass', detail: `Reviewed by ${reviewers}.`, value: found.activity }
    },
  }

  return { ciSettled, reviewReceived }
}
