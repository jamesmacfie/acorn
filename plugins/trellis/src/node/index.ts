import { join } from 'node:path'
import { lazyRouter, registerDeletedTaskPurge, type NodePlugin } from '@acorn/plugin-api/node'
import type { AppStore } from '../server/store'
import { appTools } from '../server/tools'

// Trellis hosts agent-built apps (docs/agent-built-apps.md): an agent's OpenUI Lang program and the
// dashboard plans it reads, kept as files under the data root, checked and published by the app tools,
// and drawn in the conversation. "App" is the product word; the code name keeps it apart from the
// repository's apps/ folder and the desktop app.
export const trellisPlugin = (dataDir: string): NodePlugin => ({
  name: 'trellis',
  label: 'Apps',
  init: (ctx) => {
    // Opened on first use, like everything here but the tool declarations.
    let opened: Promise<AppStore> | undefined
    const store = () =>
      (opened ??= import('../server/store').then(({ AppStore }) => new AppStore(join(dataDir, 'apps'))))
    for (const tool of appTools({
      store,
      workspaceOf: (taskId) => ctx.core.tasks.workspaceId(taskId),
      // As the Node, because a task token can't spend the person's connection, as panel_show does.
      planProblems: (workspaceId, plan, userId, signal) =>
        ctx.dashboards.planProblems(workspaceId, plan, {
          principal: { kind: 'internal', scope: 'service', userId },
          signal,
        }),
      planGuide: (workspaceId) => ctx.dashboards.guide(workspaceId),
    }))
      ctx.tools.register(tool)
    ctx.routes.register(
      lazyRouter(async () => (await import('../server/routes')).appRoutes(await store())),
      { prefix: '', note: '/apps — what an app card reads, and Restore' },
    )
    registerDeletedTaskPurge(ctx, async (taskIds) => (await store()).removeTasks(taskIds))
  },
})
