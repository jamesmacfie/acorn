// The github plugin's node part (docs/vNext/plugins.md § The plugin API).
//
// The last conversion of Phase 2, and the one with the most cross-boundary debt attached to it. What the
// composition root and core used to do by hand:
//
//   - apps/node/src/server/routes.ts registered THIRTEEN github routers with `registerRoute({ plugin:
//     'github', … })`. All of them are registered here now, and that file is empty of github.
//   - @acorn/node-core's schema.ts owned thirteen tables: the ten-table PR mirror, `sync_state`, and the
//     two app-state tables keyed by a GitHub repo id (`viewed_files`, `pinned_repos`).
//   - packages/node-core/src/server/routes/pins.ts was a CORE route over `pinned_repos`. It is this
//     plugin's now, at /v2/p/github/pins.
//   - packages/node-core/src/server/db/resourceKeys.ts built the four `sync_state` key shapes. It moved
//     into this package with the table.
//   - packages/node-core/src/server/agentTools/contextSections.ts' `pr` section joined
//     `repos ⋈ pull_requests ⋈ pr_files` directly. It takes an injected source now, exactly as `notes`
//     and `memory` already did.
//   - packages/node-core/src/main/storageFootprint.ts counted `repos` and `pull_requests` at boot.
//   - apps/node/src/wiring/workflowWiring.ts (44 lines) re-derived CI state from `repos` + `checks`, and
//     its own header said it existed only because "github is not converted, so there is no
//     `github.checkState` capability to resolve and no plugin that could publish one". DELETED.
//   - apps/node/src/wiring/startupSecurity.ts had one call left, the mirror prune, and said it would go
//     "the same way when github converts; the file is then deleted rather than kept as an empty hook".
//     DELETED.
//
// The last four are one capability, `github.mirror` (contract/mirror.ts), with three methods. They are
// grouped rather than published as three ids because they are one question asked three ways — "what does
// the mirror currently know?" — and a consumer that resolves one of them is in exactly the same position
// about plugin absence as a consumer that resolves another.
//
// `required: true`, per plugins.md, and here it is not a preference: the PR review surface is the app's
// original reason to exist, `repos` is what the repo picker and the onboarding scan read, and a node with
// this off would boot into a workspace with no repos and no way to add any.
//
// ORDERING NOTE, because it is the one thing that could go subtly wrong here. `init` is awaited BEFORE
// the listener binds (server/plugin/types.ts), and the mirror prune below is deliberately inside it: it
// is a bounded repair pass that deletes orphaned child rows, and a request served while it ran would be
// able to read a PR whose parent repo row was about to disappear. That is the same guarantee
// startupSecurity.ts provided by running pre-listener, so moving it here preserves it rather than
// relaxing it. Nothing else in this init does I/O against GitHub — mirror REFRESH is demand-driven by
// serve-then-revalidate on a request, never at boot — so init stays fast and cannot wedge the boot on a
// network timeout.
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { openPluginDb } from '@acorn/node-core/main/pluginStorage.ts'
import { setRepoMirrorSource } from '@acorn/node-core/server/repoMirror.ts'
import { pullRequestSection } from '@acorn/node-core/server/agentTools/contextSections.ts'
import { GITHUB_MIRROR } from '../contract/mirror'
import { actions } from '../server/routes/actions'
import { githubDeviceAuth } from '../server/routes/deviceAuth'
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
import {
  failingChecksFor,
  mirrorFootprint,
  mirroredDefaultBranch,
  mirroredIdentities,
  mirroredPullRequest,
  mirroredRepoList,
} from '../server/mirrorQueries'
import { pruneOrphanedGithubMirror } from '../server/mirrorRetention'
import { migrationsDir } from './migrations'

export const githubPlugin = (dataDir: string): NodePlugin => {
  let db: ReturnType<typeof openPluginDb> | null = null
  return {
    name: 'github',
    required: true,
    init: async (ctx) => {
      // Opened and migrated before the listener binds. Every router below is a FACTORY closing over this
      // handle rather than a module-scope router reading `getDb(c.env)`, for the reason
      // plugins/changes/src/server/routes/reviewNotes.ts states first: the tables are in
      // <data-root>/plugins/github.sqlite now, and `c.env` deliberately carries no per-plugin handles
      // (docs/vNext/data.md § Plugin DBs). So there is no request that can reach an unmigrated database.
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
      // The one github router with no handle at all: it shells out to git in the repo's checkout, and the
      // checkout path comes from core's `repo_paths` through CoreServices.
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
      // The device-flow connect, which writes CORE's `integrations` row through core's own
      // connectProvider. It touches none of this plugin's tables, so it takes no handle.
      ctx.routes.register(githubDeviceAuth, { prefix: '', note: '/auth/device/* — OAuth device-flow connect' })

      // github.mirror (contract/mirror.ts) — the three questions other packages used to answer by
      // querying core's database. Each closes over the handle; none of them fetches, so a cold mirror
      // answers "nothing known" rather than blocking a prompt assembly or a policy evaluation on GitHub.
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

      // Core's own three reads of the mirror — workspace bootstrap, the `repo_info` tool's default branch,
      // and the sole-identity check — go through a slot rather than the capability registry, because two of
      // the three consumers are route handlers and `c.env` deliberately cannot reach the plugin graph
      // (@acorn/node-core/server/repoMirror.ts states the reasoning). Filling it from init, rather than
      // leaving it to the composition root, is what keeps it filled for `dev:node` too.
      setRepoMirrorSource({
        list: (userId) => mirroredRepoList(store, userId),
        defaultBranch: (userId, owner, name) => mirroredDefaultBranch(store, userId, owner, name),
        identities: () => mirroredIdentities(store),
      })
    },
    // The plugin's SQLite file is in WAL mode, so it has to be closed before the data root's lock is
    // dropped — the composition root's own teardown invariant. Every router above closes over the handle
    // and is discarded with the plugin's route contributions by the host, so unlike the plugins that fill
    // a module-scope bridge slot there is nothing here to null out: a second startServiceRuntime in one
    // process builds fresh routers over its own handle.
    dispose: () => {
      // Cleared explicitly rather than trusting teardown order: the slot is a module-scope singleton, so a
      // second startServiceRuntime in one process would otherwise leave core's workspace bootstrap and
      // identity check reading through this boot's CLOSED handle.
      setRepoMirrorSource(null)
      db?.close()
      db = null
    },
  }
}
