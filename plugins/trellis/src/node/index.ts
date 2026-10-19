import { join } from 'node:path'
import { lazyRouter, registerDeletedTaskPurge, type NodePlugin } from '@acorn/plugin-api/node'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { APP_CHANGED_VERB } from '../shared/api'
import type { AppMeta, AppStore } from '../server/store'
import { appTools } from '../server/tools'

// Trellis hosts agent-built apps (docs/agent-built-apps.md): an agent's OpenUI Lang program and the
// dashboard plans it reads, kept as files under the data root, checked and published by the app tools,
// and drawn in the conversation. "App" is the product word; the code name keeps it apart from the
// repository's apps/ folder and the desktop app.
export const trellisPlugin = (dataDir: string): NodePlugin => ({
  name: 'trellis',
  label: 'Apps',
  emits: [{ verb: APP_CHANGED_VERB, description: "An app's head revision moved" }],
  init: (ctx) => {
    // Opened on first use, like everything here but the tool declarations.
    let opened: Promise<AppStore> | undefined
    const store = () =>
      (opened ??= import('../server/store').then(({ AppStore }) => new AppStore(join(dataDir, 'apps'))))
    const changed = ({ appId, taskId }: AppMeta) =>
      ctx.events.send({ channel: pluginChannel('trellis', APP_CHANGED_VERB), appId, taskId })
    for (const tool of appTools({
      store,
      changed,
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
      lazyRouter(async () => (await import('../server/routes')).appRoutes(await store(), changed)),
      { prefix: '', note: '/apps — what an app card and the Apps pane read, Restore, and saved state' },
    )
    // Archive keeps a task's apps where they are, so restore brings them back at the head they had.
    // The dialog says so, which is all this check is for.
    ctx.taskChecks.register({
      id: 'apps',
      check: async (task) => {
        const apps = (await (await store()).forTask(task.id)).filter((meta) => meta.head > 0)
        if (!apps.length) return null
        return {
          id: 'apps',
          severity: 'warn' as const,
          message:
            apps.length === 1
              ? "1 app belongs to this task. It's archived with it and comes back if you restore it."
              : `${apps.length} apps belong to this task. They're archived with it and come back if you restore it.`,
          details: apps.slice(0, 5).map((meta) => meta.name),
          ...(apps.length > 5 ? { detailsMore: apps.length - 5 } : {}),
        }
      },
    })
    registerDeletedTaskPurge(ctx, async (taskIds) => (await store()).removeTasks(taskIds))
  },
})
