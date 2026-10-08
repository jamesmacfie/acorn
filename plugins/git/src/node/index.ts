import type { NodePlugin } from '@acorn/plugin-api/node'

export const gitPlugin = (): NodePlugin => ({
  name: 'git',
  label: 'Git',
  async init(ctx) {
    const { worktreeRoutes } = await import('../server/routes/worktrees')
    ctx.routes.register(worktreeRoutes(ctx.core), { prefix: '', note: 'project worktree inventory and guarded cleanup' })
    const { historyRoutes } = await import('../server/routes/history')
    ctx.routes.register(historyRoutes(ctx.core), { prefix: '', note: 'pinned history and read-only revision documents' })
    const { stashRoutes } = await import('../server/routes/stashes')
    ctx.routes.register(stashRoutes(ctx.core, ctx.events), { prefix: '', note: 'stash roster and guarded task checkout writes' })
    const { explanationRoutes } = await import('../server/routes/explain')
    ctx.routes.register(explanationRoutes(ctx.core), { prefix: '', note: 'explicit bounded Git explanations' })
  },
})
