import { Hono } from 'hono'
import type { AppEnv, CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import type { GithubEmit } from '../events'
import { actions } from './checks/actions'
import { diffDocument } from './pulls/diffDocument'
import { mentions } from './pulls/mentions'
import { prActions } from './pulls/prActions'
import { prCreate } from './pulls/prCreate'
import { pullBlob } from './pulls/pullBlob'
import { pullConflicts } from './pulls/pullConflicts'
import { pullDetail } from './pulls/pullDetail'
import { pullFiles } from './pulls/pullFiles'
import { pulls } from './pulls/pulls'
import { pullsBatch } from './pulls/pullsBatch'
import { repoLabels } from './repos/repoLabels'
import { repos } from './repos/repos'

// Everything under /v1/p/github/repos, built on the first request to it (node/index.ts registers it
// with lazyRouter). Several of these routers declare overlapping paths (/:owner/:repo/pulls/:number/...),
// so this order is the order Hono matches them. Reshuffling it changes which handler wins.
export const mirrorRoutes = (store: PluginDatabase, core: CoreServices, emit: GithubEmit) =>
  new Hono<AppEnv>()
    .route('/', repos(store, emit))
    .route('/', repoLabels(store, emit))
    // Takes `core` as well as the handle: refreshing the open-PR list also adopts a PR into any
    // local-first task on that branch (Flow B). `tasks` is core's table, so that write goes through
    // CoreServices.tasks.adoptPullNumbers instead of the mirror's transaction.
    .route('/', pulls(store, core, emit))
    .route('/', pullDetail(store, emit))
    // The one github router with no plugin database handle: it shells out to git in the mapped project
    // checkout, and the path comes from CoreServices.projects through the core git seam.
    .route('/', pullConflicts(core))
    .route('/', pullFiles(store, emit))
    .route('/', pullBlob(store, emit))
    // A diff document's segment and search reads, shared by pull requests and compare previews.
    .route('/', diffDocument(store, emit))
    .route('/', pullsBatch(store, emit))
    .route('/', prActions(store, emit))
    // Workflow-run and job reads and re-runs. It resolves everything from the GitHub API and the
    // URL, so it holds no mirror state and takes no handle.
    .route('/', actions)
    .route('/', prCreate(store, emit))
    .route('/', mentions(store))
