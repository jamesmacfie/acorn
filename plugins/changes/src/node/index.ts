import { type NodePlugin } from '@acorn/plugin-api/node'
import { localGitAgentTools } from '../main/agentTools'
import { changesArchiveConcern } from '../main/archiveCheck'
import { localGitBridge } from '../main/localGit'
import { localGit, LOCAL_GIT } from '../server/routes/localGit'
import { reviewNotesRoutes } from '../server/routes/reviewNotes'

export const changesPlugin = (): NodePlugin => {
  let capability: { dispose(): void } | null = null
  return {
  name: 'changes',
  // This module's own URL, because the chain sits at plugins/changes/migrations beside it. The host
  // resolves it and owns open/migrate/close from there (@acorn/node-core/main/pluginStorage.ts).
  migrationsModule: import.meta.url,
  init: async (ctx) => {
    // Opened and migrated by the host before init returns, so there is no moment where a request can
    // reach an unmigrated database: the route factory below closes over the handle.
    const db = ctx.storage.open()
    ctx.routes.register(reviewNotesRoutes(db, ctx.core), { prefix: '/tasks', note: '/:id/review-notes' })
    // localGit holds no tables of its own: it shells out to git in the task worktree, so it needs
    // core's task resolution and nothing else.
    const bridge = localGitBridge(ctx.core, ctx.events.status)
    capability = ctx.capabilities.provide(LOCAL_GIT, bridge)
    // Archiving removes the worktree, so uncommitted work goes with it. Advisory only — this check
    // names the files and stops there (main/archiveCheck.ts).
    ctx.taskChecks.register({ id: 'uncommitted', check: (task) => changesArchiveConcern(bridge, task) })
    ctx.routes.register(localGit, { prefix: '/tasks', note: '/:id/local/*' })
    // local_changes / local_diff / git_log. Same module as the bridge above, so the agent and the review
    // pane cannot disagree about the working tree.
    for (const tool of localGitAgentTools(ctx.core)) ctx.tools.register(tool)
  },
  // The capability slot only. The SQLite handle is the host's to drain, right after this returns.
  dispose: () => {
    capability?.dispose()
  },
  }
}
