import type { NodePlugin } from '@acorn/plugin-api/node'

type Context = Parameters<NonNullable<NodePlugin['init']>>[0]

export async function registerGit(ctx: Context): Promise<() => void> {
  const { registerChanges } = await import('./changes/registerChanges')
  const disposeChanges = registerChanges(ctx)
  const { worktreeRoutes } = await import('./routes/worktrees')
  ctx.routes.register(worktreeRoutes(ctx.core), { prefix: '', note: 'project worktree inventory and guarded cleanup' })
  const { historyRoutes } = await import('./routes/history')
  ctx.routes.register(historyRoutes(ctx.core), { prefix: '', note: 'pinned history and read-only revision documents' })
  const { stashRoutes } = await import('./routes/stashes')
  ctx.routes.register(stashRoutes(ctx.core, ctx.events), {
    prefix: '',
    note: 'stash roster and guarded task checkout writes',
  })
  const { operationRoutes } = await import('./routes/operations')
  ctx.routes.register(operationRoutes(ctx.core, ctx.events), {
    prefix: '',
    note: 'task Git operations and their continue, skip, and abort controls',
  })
  const { conflictRoutes } = await import('./routes/conflicts')
  ctx.routes.register(conflictRoutes(ctx.core, ctx.events), {
    prefix: '',
    note: 'three-way conflict reads and guarded save and stage',
  })
  const { explanationRoutes } = await import('./routes/explain')
  ctx.routes.register(explanationRoutes(ctx.core), { prefix: '', note: 'explicit bounded Git explanations' })
  const { refRoutes } = await import('./routes/refs')
  ctx.routes.register(
    refRoutes(ctx.core, () => ctx.events.worktreeStatus(null)),
    { prefix: '', note: 'repository refs and guarded metadata writes' },
  )
  const { RemoteService } = await import('./remotes')
  const { remoteRoutes } = await import('./routes/remotes')
  const remotes = new RemoteService(ctx.core, undefined, () => ctx.events.worktreeStatus(null))
  ctx.routes.register(remoteRoutes(remotes), { prefix: '', note: 'repository remotes and explicit fetch' })
  const { AutoFetcher } = await import('./autoFetch')
  const autoFetcher = new AutoFetcher(ctx.core, remotes)
  ctx.schedules.register({
    scheduleId: 'auto-fetch',
    name: 'Fetch Git remotes',
    cadence: { every: 300 },
    timeout: 300,
    run: (signal) => autoFetcher.tick(signal),
  })
  const { lineBlameRoutes } = await import('./routes/lineBlame')
  ctx.routes.register(lineBlameRoutes(ctx.core), { prefix: '', note: 'who last changed the Editor cursor line' })
  const { comparisonRoutes } = await import('./routes/comparison')
  ctx.routes.register(comparisonRoutes(ctx.core), { prefix: '', note: 'pin direct and merge-base comparisons' })
  const { settingsRoutes } = await import('./routes/settings')
  ctx.routes.register(
    settingsRoutes(ctx.core, (enabled) => autoFetcher.setEnabled(enabled)),
    { prefix: '', note: 'scoped Git identity and Node preferences' },
  )
  return () => {
    autoFetcher.dispose()
    remotes.dispose()
    disposeChanges()
  }
}
