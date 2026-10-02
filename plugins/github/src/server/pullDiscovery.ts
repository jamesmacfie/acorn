import { z } from 'zod'
import { describeError, type NodePlugin } from '@acorn/plugin-api/node'
import type { AgentTurnChangedEvent } from '@acorn/plugin-agents/contract/lifecycle.ts'
import { gh, ghError } from './githubApi'

type DiscoveryContext = Pick<Parameters<NodePlugin['init']>[0], 'core' | 'providers' | 'events' | 'log'>

const pullSchema = z.object({
  number: z.number().int().positive(),
  state: z.string(),
  head: z.object({ ref: z.string(), repo: z.object({ full_name: z.string() }).nullable() }),
  base: z.object({ repo: z.object({ full_name: z.string() }) }),
})

// Observe the agent lifecycle through its public event. Branch adoption does not establish who
// created a PR, so it uses core's adoption seam rather than inventing managed-session provenance.
export function startPullDiscovery(ctx: DiscoveryContext): { dispose(): Promise<void> } {
  const running = new Set<Promise<void>>()
  let stopped = false

  const discover = async (taskId: string): Promise<void> => {
    const userId = ctx.core.identity.active()
    if (!userId) return
    const task = await ctx.core.tasks.load(taskId)
    if (!task?.branch || task.pullNumber != null) return
    const branch = task.branch
    const project = await ctx.core.projects.byId(task.projectId)
    if (!project?.github) return
    const { owner, name: repo } = project.github
    const repository = `${owner}/${repo}`.toLowerCase()
    const query = new URLSearchParams({ state: 'open', head: `${owner}:${branch}`, per_page: '2' })

    await ctx.providers.withConnection(userId, 'github', async (_connection, token) => {
      const response = await gh(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?${query}`)
      const failure = ghError(response)
      if (failure) throw new Error(failure.error)
      const pulls = z.array(pullSchema).parse(await response.json())
      // Two results or a continuation are ambiguous. Never choose a primary by provider ordering.
      if (pulls.length !== 1 || /\brel="next"/.test(response.headers.get('link') ?? '')) return
      const [pull] = pulls
      if (pull.state !== 'open' || pull.head.ref !== branch
        || pull.head.repo?.full_name.toLowerCase() !== repository
        || pull.base.repo.full_name.toLowerCase() !== repository) return

      // The task or owner may change while GitHub answers. Core also guards the adoption write
      // against a primary claimed concurrently and a branch changed after its candidate read.
      if (stopped || ctx.core.identity.active() !== userId) return
      const current = await ctx.core.tasks.load(taskId)
      if (stopped || !current || current.projectId !== task.projectId || current.branch !== branch || current.pullNumber != null) return
      await ctx.core.tasks.adoptPullNumbers(owner, repo, new Map([[branch, pull.number]]))
    })
  }

  const subscription = ctx.events.on('plugin:agents:turn-changed', (frame) => {
    const event = frame as { channel: string } & AgentTurnChangedEvent
    if (stopped || event.status !== 'completed') return
    const work = discover(event.taskId)
      .catch((error: unknown) => ctx.log.warn('Pull request discovery failed', { taskId: event.taskId, ...describeError(error) }))
      .finally(() => running.delete(work))
    running.add(work)
  })

  return {
    dispose: async () => {
      stopped = true
      subscription.dispose()
      await Promise.all(running)
    },
  }
}
