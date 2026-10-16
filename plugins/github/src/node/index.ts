import { lazyFetch, lazyRouter, type NodePlugin } from '@acorn/plugin-api/node'
import { GITHUB_MIRROR } from '../contract/mirror'
import { githubDeviceAuth } from '../server/routes/deviceAuth'
import { githubImport } from '../server/routes/repos/import'
import { createGithubProvider } from '../server/provider'
import { mirrorFootprint, mirroredPullRequest } from '../server/mirrorQueries'
import { WORKFLOW_POLICY } from '../contract/workflowPolicies'
import { githubWorkflowPolicies } from '../server/workflowPolicies'
import { pruneOrphanedGithubMirror } from '../server/mirrorRetention'
import { githubClientId } from '../server/config'
import { githubAgentTools } from '../server/agentTools'
import { taskPulls } from '../server/routes/pulls/taskPulls'
import { changeRequestRoutes } from '../server/routes/changeRequests'
import { githubEmitter } from '../server/events'
import { readCachedRepos, toPublicRepo } from '../server/routes/mirror/repoMirror'
import { pullSource } from '../shared/pullSource'
import { actionsSource } from '../shared/actionsRegistration'
import { branchSource } from '../shared/branchSource'
import { EDITOR_LINE_MARKERS } from '@acorn/plugin-editor/contract/lineMarkers.ts'
import { pullRequestEditorLineMarkers } from '../server/editorLineMarkers'
import { startPullDiscovery } from '../server/pullDiscovery'
import { setGithubApiTelemetry } from '../server/githubApi'

export const githubPlugin = (): NodePlugin => {
  let discovery: ReturnType<typeof startPullDiscovery> | null = null
  return {
    name: 'github',
    label: 'GitHub',
    required: false,
    // What other plugins may hear from this one
    // (docs/plugins/events.md § Hearing another plugin). workflows hears
    // `checks-changed`.
    emits: [
      { verb: 'checks-changed', description: 'A pull request’s checks changed state' },
      { verb: 'pr-synced', description: 'A pull request’s mirror was committed or invalidated' },
      { verb: 'pulls-changed', description: 'A repository’s open pull request list was refreshed' },
      { verb: 'repos-changed', description: 'The repository mirror changed' },
    ],
    // This module's own URL, so the host can walk from here for the migration chain
    // (docs/plugins/data-ownership.md § Data ownership).
    migrationsModule: import.meta.url,
    // Projects whose remote is on github.com are GitHub's (docs/plugins/code-hosts.md). GitHub serves
    // every pull request's head at `pull/<n>/head`, a fork's included, and the PR pane shows one. Core's
    // agent tools read a task's pull request from the routes under `api`.
    codeHost: {
      label: 'GitHub',
      hosts: ['github.com'],
      changeRequest: {
        ref: 'pull/{number}/head',
        label: 'pull request',
        prefix: '#',
        pane: 'pr',
        api: '/v1/p/github/change-requests',
      },
    },
    // The pull request button on github.com
    // (docs/github-integration/tasks-and-references.md § Browser handoff). Its route below loads on
    // the first handoff.
    browserHandoffs: [
      {
        id: 'pull-request',
        label: 'Open in Acorn',
        // The conversation and its tabs (`files`, `commits`, `checks`).
        match: [
          'https://github.com/{owner}/{repo}/pull/{number}',
          'https://github.com/{owner}/{repo}/pull/{number}/{tab}',
        ],
        // The header's action row in a wide window, the state line under the title in a narrow one
        // (GitHub hides the action row there), and the action row of the older layout.
        anchors: ['[data-component="PH_Actions"]', '[data-component="PageHeader.Description"]', '.gh-header-actions'],
        resolve: '/v1/p/github/browser/pull-request',
      },
    ],
    // The task's pull request in the extension's sidebar (docs/plugin-authoring/browser-panel.md). `pane`
    // is the PR pane's ID in the client half, which the host can't see from here.
    browserPanel: { label: 'Pull request', glyph: 'git-pull-request', pane: 'pr', route: '/v1/p/github/browser-panel' },
    init: async (ctx) => {
      // Opens and migrates before init returns; every router below closes over this handle rather
      // than reading one off the request environment (docs/data-layer/plugin-databases.md § Plugin databases).
      const store = ctx.storage.open()
      setGithubApiTelemetry(ctx.telemetry)
      ctx.extensionPoints.handle(EDITOR_LINE_MARKERS, {
        id: 'pull-request',
        value: pullRequestEditorLineMarkers(store, ctx.core),
      })
      // github's own `plugin:github:<verb>` channel (docs/plugins/events.md § Hearing another plugin).
      // Only the routers that write the PR mirror take it.
      const emit = githubEmitter(ctx.events.send)

      // Bounded startup repair of parent-only mirror evictions. Runs before any route registers.
      const { removedPulls } = await pruneOrphanedGithubMirror(store)
      if (removedPulls) ctx.log.info(`pruned ${removedPulls} orphaned mirrored pull requests`)

      // Registers the provider in both the connection and integration registries. Required:
      // connectProvider looks github up in the connection registry, so without it the device-flow
      // poll fails provider_bad_config and github can never connect. A machine that is already signed
      // in hides the break, because githubToken() reads the stored row and never consults the registry.
      //
      // The device-flow router registers separately below because github's routes share a namespace
      // with the mirror routers, whose order is load-bearing (`mirrorRoutes`).
      ctx.providers.integration(createGithubProvider({ connectable: githubClientId() !== '' }))
      // The three source handlers load on their first request
      // (docs/plugin-authoring/the-node-half.md § Load a route on first use). The descriptors register
      // now, so the sources exist before then.
      ctx.routes.fetch(
        lazyFetch(async () => (await import('../server/data/pullSourceHandler')).createPullSourceHandler()),
        { prefix: '/data/pulls' },
      )
      ctx.dataSources.register(pullSource)
      ctx.routes.fetch(
        lazyFetch(async () =>
          (await import('../server/data/branchSourceHandler')).createBranchSourceHandler(ctx.dataSources.invoke),
        ),
        { prefix: '/data/branches' },
      )
      ctx.dataSources.register(branchSource)
      ctx.routes.fetch(
        lazyFetch(async () => (await import('../server/data/actionsSourceHandler')).createActionsSourceHandler()),
        { prefix: '/data/actions' },
      )
      ctx.dataSources.register(actionsSource)

      // /v1/p/github/repos/* is the mirror. Its routers serve nothing until a client asks for GitHub
      // data, so they load on that first request, in the order `mirrorRoutes` keeps.
      ctx.routes.register(
        lazyRouter(async () => (await import('../server/routes/mirrorRoutes')).mirrorRoutes(store, ctx.core, emit)),
        { prefix: '/repos', note: 'repository and pull request mirror' },
      )
      ctx.routes.register(taskPulls(ctx.core), { prefix: '/tasks', note: '/:taskId/pulls — durable task PR relations' })
      ctx.routes.register(changeRequestRoutes(store, ctx.core, emit), {
        prefix: '/change-requests',
        note: "a task's pull request for core's agent tools and `pr` context section",
      })
      // The device-flow connect writes core's own `integrations` row through connectProvider
      // (docs/github-integration.md § Connecting). It touches none of this plugin's tables, so it
      // takes no handle.
      ctx.routes.register(githubDeviceAuth(githubClientId), {
        prefix: '',
        note: '/auth/device/* — OAuth device-flow connect',
      })
      ctx.routes.register(githubImport(store, ctx.core), {
        prefix: '',
        note: 'POST /import — import mirrored repositories into core projects',
      })

      ctx.routes.fetch(
        lazyFetch(async () => {
          const handoff = await import('../server/browserHandoff')
          return handoff.createBrowserHandoffHandler({
            readPull: handoff.mirroredPullReader(store, emit),
            projectsForRepo: (owner, name) => handoff.projectsTrackingRepo(ctx.core.projects, owner, name),
          })
        }),
        { prefix: '/browser' },
      )

      ctx.routes.register(
        lazyRouter(async () =>
          (await import('../server/browserPanel')).browserPanel(store, ctx.core, emit, () => ctx.events.status()),
        ),
        { prefix: '/browser-panel', note: "GET ?taskId= — the task's pull request in the extension's sidebar" },
      )

      for (const tool of githubAgentTools(store, ctx.core, ctx.providers, () => ctx.events.status(), emit))
        ctx.tools.register(tool)
      discovery = startPullDiscovery(ctx)

      // Two `gate-policy` verdict sources, filed against the workflows plugin's point by its id string
      // (../contract/workflowPolicies.ts says why). They become `github:ci-settled` and
      // `github:review-received`.
      const policies = githubWorkflowPolicies(store, ctx.core, ctx.providers, emit)
      ctx.extensionPoints.handle(WORKFLOW_POLICY, { id: 'ci-settled', value: policies.ciSettled })
      ctx.extensionPoints.handle(WORKFLOW_POLICY, { id: 'review-received', value: policies.reviewReceived })

      ctx.capabilities.provide(GITHUB_MIRROR, {
        repositories: async (userId) => (await readCachedRepos(store, userId)).map(toPublicRepo),
        pullRequest: (userId, repoOwner, repoName, pullNumber) =>
          mirroredPullRequest(store, userId, repoOwner, repoName, pullNumber),
        footprint: () => mirrorFootprint(store),
      })
    },
    dispose: async () => {
      await discovery?.dispose()
      discovery = null
    },
  }
}
