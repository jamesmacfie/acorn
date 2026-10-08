import type { NodePlugin } from '@acorn/plugin-api/node'

export const gitPlugin = (): NodePlugin => ({
  name: 'git',
  label: 'Git',
  async init(ctx) {
    const { worktreeRoutes } = await import('../server/routes/worktrees')
    ctx.routes.register(worktreeRoutes(ctx.core), { prefix: '', note: 'project worktree inventory and guarded cleanup' })
    const { historyRoutes } = await import('../server/routes/history')
    ctx.routes.register(historyRoutes(ctx.core), { prefix: '', note: 'pinned history and read-only revision documents' })
  },
})
