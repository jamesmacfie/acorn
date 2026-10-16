// The two workflow policies this plugin contributes, `bitbucket:ci-settled` and
// `bitbucket:review-received` (docs/workflows/step-kinds.md § Gate policies). `checks-green`, `ci-loop`
// and `review-received` ask a Bitbucket task's code host for them.
//
// Each poll reads the task's pull request from Bitbucket first, because the mirror otherwise refreshes
// only when somebody opens it, and a run nobody watches would read a copy older than the agent's push.
// That is four requests a poll, at the 30 second floor the policies declare.
import type { CoreServices, PluginDatabase, StoredConnection } from '@acorn/plugin-api/node'
import type { CiSettledValue, PolicyContribution, PolicyVerdict } from '@acorn/plugin-workflows/contract/extensions.ts'
import { BITBUCKET_PROVIDER } from './bitbucketApi'
import {
  mirroredPullRequest,
  readStatuses,
  refreshPullRequest,
  reviewActivitySince,
  type MirrorKey,
} from './mirror/detail'
import { checkFailed, checkPending, sameCommit } from './mirror/vocabulary'
import { taskPullRequest } from './taskPullRequest'
import { ciSettledDescription, reviewReceivedDescription, validateReviewReceived } from './policyDescriptions'
import type { BitbucketEmit } from './events'
import type { BitbucketAccount } from './account'

type PolicyCore = Pick<CoreServices, 'tasks' | 'projects' | 'identity'>
type ProviderAccess = {
  withConnection<T>(
    userId: string,
    providerId: string,
    visit: (connection: StoredConnection, secret: string) => Promise<T | undefined>,
    connectionId?: string,
  ): Promise<T | undefined>
}

const NO_PULL_REQUEST: PolicyVerdict = {
  verdict: 'fail',
  detail: 'This task has no pull request in a Bitbucket repository Acorn can read.',
}

export function bitbucketWorkflowPolicies(
  db: PluginDatabase,
  core: PolicyCore,
  providers: ProviderAccess,
  account: BitbucketAccount,
  emit: BitbucketEmit,
): { ciSettled: PolicyContribution; reviewReceived: PolicyContribution } {
  /** The task's pull request, read again from Bitbucket. A throw is a failed poll, which the gate
   *  retries. */
  async function refreshed(taskId: string): Promise<MirrorKey | { verdict: PolicyVerdict }> {
    const key = await taskPullRequest(core, account, taskId)
    const owner = core.identity.active()
    if (!key || !owner) return { verdict: NO_PULL_REQUEST }
    const result = await providers.withConnection(
      owner,
      BITBUCKET_PROVIDER,
      (_connection, auth) => refreshPullRequest({ auth }, db, key, emit),
      key.connectionId,
    )
    if (!result) throw new Error('Bitbucket is not connected.')
    if (!result.ok) throw new Error(`Bitbucket refresh failed: ${result.failure.detail?.[0] ?? result.failure.error}`)
    return key
  }

  const ciSettled: PolicyContribution = {
    describe: ciSettledDescription,
    evaluate: async (ctx) => {
      const key = await refreshed(ctx.taskId)
      if ('verdict' in key) return key.verdict
      const [row, statuses] = await Promise.all([mirroredPullRequest(db, key), readStatuses(db, key)])
      if (!row) return NO_PULL_REQUEST
      const checks = statuses.filter((status) => sameCommit(status.commitSha, row.headSha))
      if (!checks.length) {
        if (statuses.length) return { verdict: 'wait', detail: 'The build statuses are still for an older commit.' }
        return ctx.with.missing === 'wait'
          ? { verdict: 'wait', detail: 'The pull request has no build statuses yet.' }
          : { verdict: 'fail', detail: 'The pull request has no build statuses.' }
      }
      const value: CiSettledValue = {
        failing: checks
          .filter((check) => checkFailed(check.status))
          .map(({ name, status, url }) => ({ name, status, url })),
        pending: checks.filter((check) => checkPending(check.status)).map((check) => check.name),
        total: checks.length,
      }
      // Every build finishes before an answer, so a fix turn sees the whole list of failures.
      if (value.pending.length) {
        const finished = value.total - value.pending.length
        return { verdict: 'wait', detail: `Builds running: ${finished} of ${value.total} finished.`, value }
      }
      if (value.failing.length) {
        const names = value.failing.map((check) => check.name).join(', ')
        return { verdict: 'fail', detail: `${value.failing.length} of ${value.total} builds failed: ${names}`, value }
      }
      return { verdict: 'pass', detail: `All ${value.total} builds passed.`, value }
    },
  }

  const reviewReceived: PolicyContribution = {
    describe: reviewReceivedDescription,
    validate: validateReviewReceived,
    evaluate: async (ctx) => {
      const key = await refreshed(ctx.taskId)
      if ('verdict' in key) return key.verdict
      const found = await reviewActivitySince(db, key, ctx.since, { includeBots: ctx.with.include_bots === true })
      if (!found) return NO_PULL_REQUEST
      if (found.state !== 'open') return { verdict: 'fail', detail: `The pull request was ${found.state}.` }
      if (!found.activity.length) return { verdict: 'wait', detail: 'No review yet.' }
      const reviewers = [...new Set(found.activity.map((item) => item.author ?? 'someone'))].join(', ')
      return { verdict: 'pass', detail: `Reviewed by ${reviewers}.`, value: found.activity }
    },
  }

  return { ciSettled, reviewReceived }
}
