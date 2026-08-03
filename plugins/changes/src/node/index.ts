// The changes plugin's node part (docs/vNext/plugins.md § The plugin API).
//
// This is what the composition root used to do by hand: apps/node/src/server/routes.ts registered the
// two routers, apps/node/src/wiring/serverBridges.ts connected localGit's route to its impl, and
// nothing owned the plugin's tables. All three are here now, and the plugin owns its own SQLite file.
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { openPluginDb } from '@acorn/node-core/main/pluginStorage.ts'
import { migrationsDir } from './migrations'
import { localGitBridge } from '../main/localGit'
import { localGit, setLocalGitBridge } from '../server/routes/localGit'
import { reviewNotesRoutes } from '../server/routes/reviewNotes'

export const changesPlugin = (dataDir: string): NodePlugin => {
  let db: ReturnType<typeof openPluginDb> | null = null
  return {
  name: 'changes',
  init: async (ctx) => {
    // Opened and migrated here, before the listener binds — the route factory below closes over the
    // handle, so there is no moment where a request can reach an unmigrated database.
    db = openPluginDb(dataDir, 'changes', { migrationsFolder: migrationsDir() })
    ctx.routes.register(reviewNotesRoutes(db, ctx.core), { prefix: '/tasks', note: '/:id/review-notes' })
    // localGit holds no tables of its own: it shells out to git in the task worktree, so it needs
    // core's task resolution and nothing else.
    setLocalGitBridge(localGitBridge(ctx.core))
    ctx.routes.register(localGit, { prefix: '/tasks', note: '/:id/local/*' })
  },
  // The plugin's SQLite file is in WAL mode, so it has to be closed before the data root's lock is
  // dropped — the composition root's own teardown invariant.
  dispose: () => {
    db?.close()
    db = null
    setLocalGitBridge(null)
  },
  }
}
