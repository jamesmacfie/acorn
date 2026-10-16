// The two workflow policies this plugin contributes, `github:ci-settled` and
// `github:review-received` (docs/workflows/step-kinds.md § Gate policies). They live here because this
// plugin owns the PR copy they read and the token that refreshes it.
//
// Each poll refreshes the task's PR from GitHub first. The local copy otherwise only refreshes when
// somebody opens the PR, and a run nobody is watching would read a copy older than the agent's push.
import type { CoreServices, PluginDatabase, StoredConnection } from '@acorn/plugin-api/node'
import type { CiSettledValue, PolicyContribution, PolicyVerdict } from '@acorn/plugin-workflows/contract/extensions.ts'
import { checkFailed, checkPending, mirroredTaskPull, reviewActivitySince, taskChecks } from './mirrorQueries'
import { refreshPullDetail } from './routes/pulls/pullRefresh'
import type { GithubEmit } from './events'
import { ciSettledDescription, reviewReceivedDescription, validateReviewReceived } from './policyDescriptions'

type PolicyCore = Pick<CoreServices, 'tasks' | 'projects' | 'identity'>
type ProviderAccess = {
  withConnection<T>(
    userId: string,
    providerId: string,
    visit: (connection: StoredConnection, secret: string) => Promise<T | undefined>,
  ): Promise<T | undefined>
}

const NO_PULL: PolicyVerdict = {
  verdict: 'fail',
  detail: 'This task has no pull request in a GitHub repository Acorn has listed.',
}

type Refreshed =
  | {
      pull: NonNullable<Awaited<ReturnType<typeof mirroredTaskPull>>>
      headSha: string | null
      checksSha: string | null
    }
  | { verdict: PolicyVerdict }

export function githubWorkflowPolicies(
  db: PluginDatabase,
  core: PolicyCore,
  providers: ProviderAccess,
  emit: GithubEmit,
): { ciSettled: PolicyContribution; reviewReceived: PolicyContribution } {
  /** The task's PR, refreshed from GitHub. A throw is a failed poll, which the gate retries. */
  async function refreshed(taskId: string): Promise<Refreshed> {
    const pull = await mirroredTaskPull(db, core, core.identity.active(), taskId)
    if (!pull) return { verdict: NO_PULL }
    const result = await providers.withConnection(pull.userId, 'github', (_connection, token) =>
      refreshPullDetail(token, db, pull, emit),
    )
    if (!result) throw new Error('GitHub is not connected.')
    if (!result.ok) {
      // A push landed while the PR was being read. The next poll reads the new commit.
      if (result.failure.error === 'github_revision_changed')
        return { verdict: { verdict: 'wait', detail: 'The pull request changed while it was being read.' } }
      throw new Error(`GitHub refresh failed: ${result.failure.detail?.[0] ?? result.failure.error}`)
    }
    return { pull, headSha: result.headSha, checksSha: result.checksSha }
  }

  const ciSettled: PolicyContribution = {
    describe: ciSettledDescription,
    evaluate: async (ctx) => {
      const read = await refreshed(ctx.taskId)
      if ('verdict' in read) return read.verdict
      if (read.headSha && read.checksSha && read.headSha !== read.checksSha)
        return { verdict: 'wait', detail: 'The checks are still for an older commit.' }
      const mirrored = await taskChecks(db, read.pull)
      if (!mirrored) {
        return ctx.with.missing === 'wait'
          ? { verdict: 'wait', detail: 'The pull request has no checks yet.' }
          : { verdict: 'fail', detail: 'The pull request has no checks.' }
      }
      const value: CiSettledValue = {
        failing: mirrored.checks
          .filter((check) => checkFailed(check.status))
          .map(({ name, status, url }) => ({ name, status, url })),
        pending: mirrored.checks.filter((check) => checkPending(check.status)).map((check) => check.name),
        total: mirrored.checks.length,
      }
      // Every check finishes before an answer, so a fix turn sees the whole list of failures.
      if (value.pending.length) {
        const finished = value.total - value.pending.length
        return { verdict: 'wait', detail: `Checks running: ${finished} of ${value.total} finished.`, value }
      }
      if (value.failing.length) {
        const names = value.failing.map((check) => check.name).join(', ')
        return { verdict: 'fail', detail: `${value.failing.length} of ${value.total} checks failed: ${names}`, value }
      }
      return { verdict: 'pass', detail: `All ${value.total} checks passed.`, value }
    },
  }

  const reviewReceived: PolicyContribution = {
    describe: reviewReceivedDescription,
    validate: validateReviewReceived,
    evaluate: async (ctx) => {
      const read = await refreshed(ctx.taskId)
      if ('verdict' in read) return read.verdict
      const found = await reviewActivitySince(db, read.pull, ctx.since, { includeBots: ctx.with.include_bots === true })
      if (!found) return NO_PULL
      if (found.state !== 'open') return { verdict: 'fail', detail: `The pull request was ${found.state}.` }
      if (!found.activity.length) return { verdict: 'wait', detail: 'No review yet.' }
      const reviewers = [...new Set(found.activity.map((item) => item.author ?? 'someone'))].join(', ')
      // An approval with no comments still passes. The next step decides what an approval means.
      return { verdict: 'pass', detail: `Reviewed by ${reviewers}.`, value: found.activity }
    },
  }

  return { ciSettled, reviewReceived }
}
