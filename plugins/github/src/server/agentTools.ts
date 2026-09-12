import { z } from 'zod'
import {
  ToolError,
  type AgentToolContribution,
  type CoreServices,
  type PluginDatabase,
  type StoredConnection,
} from '@acorn/plugin-api/node'
import { createPullRequest } from './createPull'
import { checkFailed, taskChecks, taskReviewFeedback } from './mirrorQueries'
import { type GithubEmit, NO_EMIT } from './events'

type GithubToolCore = Pick<CoreServices, 'projects' | 'tasks'>
type GithubProviderAccess = {
  withConnection<T>(
    userId: string,
    providerId: string,
    visit: (connection: StoredConnection, secret: string) => Promise<T | undefined>,
  ): Promise<T | undefined>
}

export function githubAgentTools(
  db: PluginDatabase,
  core: GithubToolCore,
  providers: GithubProviderAccess,
  onAttached: () => void = () => {},
  emit: GithubEmit = NO_EMIT,
): AgentToolContribution[] {
  return [{
    name: 'github_pull_create',
    description: "Create a GitHub pull request for this task's branch and attach it to the task. The first attached PR becomes primary; later PRs become related.",
    input: z.object({
      title: z.string().min(1).describe('Pull request title'),
      body: z.string().optional().describe('Pull request description'),
      base: z.string().min(1).describe('Base branch, for example main'),
      draft: z.boolean().optional().describe('Create as a draft pull request'),
    }),
    scope: 'task',
    risk: 'write',
    whenDescription: 'Available when the task has a GitHub project, a branch, and a managed agent session.',
    when: async (ctx) => {
      if (!ctx.sessionId) return false
      const task = await core.tasks.load(ctx.taskId)
      if (!task?.branch) return false
      return !!(await core.projects.byId(task.projectId))?.github
    },
    handler: async (raw, ctx) => {
      const input = raw as { title: string; body?: string; base: string; draft?: boolean }
      if (!ctx.sessionId) throw new ToolError('bad_request', 'A managed agent session is required to create a task pull request.')
      const task = await core.tasks.load(ctx.taskId)
      if (!task) throw new ToolError('not_found', 'Task not found.')
      if (!task.branch) throw new ToolError('bad_request', 'This task has no branch to open a pull request from.')
      const project = await core.projects.byId(task.projectId)
      if (!project?.github) throw new ToolError('bad_request', 'This task project is not connected to GitHub.')

      const { owner, name: repo } = project.github
      const created = await providers.withConnection(ctx.userLogin, 'github', async (_connection, token) =>
        createPullRequest(token, db, ctx.userLogin, owner, repo, {
          ...input,
          head: task.branch!,
        }, emit))
      if (!created) throw new ToolError('failed', 'GitHub is not connected.')
      if (!created.ok) {
        const message = created.failure.detail?.[0] ?? created.failure.error
        throw new ToolError(created.failure.status === 422 || created.failure.status === 400 ? 'bad_request' : 'failed', message)
      }

      const relation = await core.tasks.attachPull(ctx.taskId, {
        repoOwner: owner,
        repoName: repo,
        pullNumber: created.number,
        sessionId: ctx.sessionId,
      })
      onAttached()
      return {
        number: created.number,
        relationship: relation.role,
        pull: { owner: relation.repoOwner, repo: relation.repoName, number: String(relation.pullNumber) },
      }
    },
  }, {
    // Two reads over the mirror this plugin already keeps fresh, so neither spends a credential or
    // touches the network. Between them they answer the two questions an agent on a reviewed PR has:
    // what did people say, and what is red (docs/agent-tools.md § GitHub).
    name: 'pr_review_comments',
    description: "What reviewers said about the current task's pull request: submitted reviews, inline comment threads, and conversation comments, from acorn's local mirror. Open threads only unless you ask for resolved ones.",
    input: z.object({
      includeResolved: z.boolean().optional().describe('include threads a reviewer has marked resolved (default: false)'),
    }),
    scope: 'task',
    risk: 'read',
    handler: async (raw, ctx) => {
      const input = raw as { includeResolved?: boolean }
      const feedback = await taskReviewFeedback(db, core, ctx.userLogin, ctx.taskId, { includeResolved: input.includeResolved })
      // Absent is not empty. "No PR mirrored for this task" and "nobody has commented" are different
      // answers, and an agent that cannot tell them apart reports the wrong thing.
      if (!feedback) return { status: 'no-mirrored-pr', hint: "This task has no mirrored pull request. Open it in acorn once, or check the task has a GitHub project and a PR." }
      return feedback
    },
  }, {
    name: 'pr_checks',
    description: "The CI checks on the current task's pull request from acorn's local mirror, with the failing ones called out. A check with no status has not run yet.",
    input: z.object({}),
    scope: 'task',
    risk: 'read',
    handler: async (_raw, ctx) => {
      const mirrored = await taskChecks(db, core, ctx.userLogin, ctx.taskId)
      if (!mirrored) return { status: 'no-mirrored-checks', hint: "No checks are mirrored for this task's pull request. This is not the same as a green PR." }
      return {
        number: mirrored.number,
        checks: mirrored.checks,
        failing: mirrored.checks.filter((row) => checkFailed(row.status)).map((row) => row.name),
      }
    },
  }]
}
