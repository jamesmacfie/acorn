import { type NodePlugin, openPluginDb, pullRequestSection } from '@acorn/plugin-api/node'
import { GITHUB_MIRROR } from '../contract/mirror'
import { actions } from '../server/routes/actions'
import { githubDeviceAuth } from '../server/routes/deviceAuth'
import { githubImport } from '../server/routes/import'
import { githubProvider } from '../server/provider'
import { mentions } from '../server/routes/mentions'
import { pins } from '../server/routes/pins'
import { prActions } from '../server/routes/prActions'
import { prCreate } from '../server/routes/prCreate'
import { pullBlob } from '../server/routes/pullBlob'
import { pullConflicts } from '../server/routes/pullConflicts'
import { pullDetail } from '../server/routes/pullDetail'
import { pullFiles } from '../server/routes/pullFiles'
import { pulls } from '../server/routes/pulls'
import { pullsBatch } from '../server/routes/pullsBatch'
import { repoLabels } from '../server/routes/repoLabels'
import { repos } from '../server/routes/repos'
import { failingChecksFor, mirrorFootprint, mirroredPullRequest } from '../server/mirrorQueries'
import { pruneOrphanedGithubMirror } from '../server/mirrorRetention'
import { migrationsDir } from './migrations'
import { githubClientId } from './config'

export const githubPlugin = (dataDir: string): NodePlugin => {
  let db: ReturnType<typeof openPluginDb> | null = null
  return {
    name: 'github',
    required: false,
    init: async (ctx) => {
      // Opened and migrated before the listener binds. Every router below is a FACTORY closing over this
      // handle rather than a module-scope router reading `getDb(c.env)`, for the reason
      // plugins/changes/src/server/routes/reviewNotes.ts states first: the tables are in
      // <data-root>/plugins/github.sqlite now, and `c.env` deliberately carries no per-plugin handles
      // (docs/data-layer.md § Plugin DBs). So there is no request that can reach an unmigrated database.
      db = openPluginDb(dataDir, 'github', { migrationsFolder: migrationsDir() })
      const store = db

      // Bounded startup repair of parent-only mirror evictions (server/mirrorRetention.ts). Pre-listener,
      // as it was when the composition root owned it — see the ordering note in this file's header.
      const { removedPulls } = await pruneOrphanedGithubMirror(store)
      if (removedPulls) ctx.log.log(`[github] pruned ${removedPulls} orphaned mirrored pull request(s)`)

      // The provider itself, into the connection AND integration registries. NOT optional and not
      // cosmetic: `connectProvider` looks github up in the connection registry, so without this the
      // device-flow poll fails `provider_bad_config` and GitHub can NEVER be connected — while an
      // already-authenticated machine keeps working, because githubToken() reads the stored row and
      // never consults the registry. That asymmetry is exactly why it went unnoticed when
      // apps/node/src/server/providers.ts was deleted: only a FRESH data root reveals it.
      //
      // The router is registered separately below rather than passed here, because github's device-flow
      // routes live under its own namespace alongside twelve mirror routers whose order is load-bearing.
      ctx.providers.integration(githubProvider)

      // /v2/p/github/repos/* — the mirror. The `/repos` prefix and the router order are carried over
      // verbatim from apps/node/src/server/routes.ts: several of these declare overlapping paths under
      // the same prefix (`/:owner/:repo/pulls/:number/...`), so the order they are registered in is the
      // order Hono matches them, and reshuffling it would change which handler wins.
      ctx.routes.register(repos(store), { prefix: '/repos' })
      ctx.routes.register(repoLabels(store), { prefix: '/repos', note: '/:owner/:repo/labels' })
      // `core` as well as the handle: refreshing the open-PR list also ADOPTS a PR into any local-first
      // task on that branch (Flow B), and `tasks` is core's table in core's file — so that write leaves the
      // mirror's transaction and goes through CoreServices.tasks.adoptPullNumbers instead.
      ctx.routes.register(pulls(store, ctx.core), { prefix: '/repos' })
      ctx.routes.register(pullDetail(store), { prefix: '/repos' })
      // The one github router with no plugin database handle: it shells out to git in the mapped project
      // checkout, and the path comes from CoreServices.projects through the core git seam.
      ctx.routes.register(pullConflicts(ctx.core), { prefix: '/repos', note: '/:owner/:repo/pulls/:number/conflicts' })
      ctx.routes.register(pullFiles(store), { prefix: '/repos' })
      ctx.routes.register(pullBlob(store), { prefix: '/repos' })
      ctx.routes.register(pullsBatch(store), { prefix: '/repos' })
      ctx.routes.register(prActions(store), { prefix: '/repos' })
      // Workflow-run/job reads and re-runs. It resolves everything from the GitHub API and the URL, so it
      // holds no mirror state and takes no handle — the one github router that genuinely needed nothing.
      ctx.routes.register(actions, { prefix: '/repos' })
      ctx.routes.register(prCreate(store), { prefix: '/repos' })
      ctx.routes.register(mentions(store), { prefix: '/repos' })
      // Moved out of core with `pinned_repos`: /v2/core/pins → /v2/p/github/pins. A wire-surface change,
      // and the client's `pinsRoute` moved with it in the same commit — the repo selector is the only
      // caller.
      ctx.routes.register(pins(store), { prefix: '/pins' })
      // The device-flow connect writes CORE's `integrations` row through core's own connectProvider.
      // It does not bind the machine identity: core mints that owner at boot. It touches none of this
      // plugin's tables, so it takes no handle.
      ctx.routes.register(githubDeviceAuth(githubClientId), { prefix: '', note: '/auth/device/* — OAuth device-flow connect' })
      ctx.routes.register(githubImport(store, ctx.core), { prefix: '', note: 'POST /import — import mirrored repositories into core projects' })

      ctx.capabilities.provide(GITHUB_MIRROR, {
        pullRequest: (userId, repoOwner, repoName, pullNumber) => mirroredPullRequest(store, userId, repoOwner, repoName, pullNumber),
        // Resolving the task itself is CORE's job — `tasks` is core's table and this plugin has no handle
        // to it — so the taskId round-trips through CoreServices before the mirror is consulted.
        failingChecks: (userId, taskId) => failingChecksFor(store, ctx.core, userId, taskId),
        footprint: () => mirrorFootprint(store),
      })

      // The `pr` context section. Its rows are this plugin's — `repos ⋈ pull_requests ⋈ pr_files` lives in
      // github.sqlite — so github registers it, and core keeps the section's budget/legacy/format contract
      // (server/agentTools/contextSections.ts). Straight to the query, not through GITHUB_MIRROR: resolving
      // its own capability out of the registry would be a plugin asking the graph about itself.
      //
      // The previous shape was a THUNK the composition root injected, precisely so an absent capability could
      // render an empty section instead of throwing. That safety is now structural: if github's init never
      // runs, the section is never registered, and `parseInclude` simply has no `pr` id to include.
      ctx.contextSections.register(pullRequestSection((userId, repoOwner, repoName, pullNumber) =>
        mirroredPullRequest(store, userId, repoOwner, repoName, pullNumber),
      ))

    },
    // The plugin's SQLite file is in WAL mode, so it has to be closed before the data root's lock is
    // dropped — the composition root's own teardown invariant. Every router above closes over the handle
    // and is discarded with the plugin's route contributions by the host.
    dispose: () => {
      db?.close()
      db = null
    },
  }
}
