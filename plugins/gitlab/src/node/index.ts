import { Hono } from 'hono'
import {
  describeError,
  lazyFetch,
  lazyRouter,
  mirrorFootprintCapability,
  requireDevice,
  type AppEnv,
  type NodePlugin,
} from '@acorn/plugin-api/node'
import { EDITOR_LINE_MARKERS } from '@acorn/plugin-editor/contract/lineMarkers.ts'
import { CODE_HOST_POLICY, WORKFLOW_POLICY } from '@acorn/plugin-workflows/contract/extensions.ts'
import { gitlabClientId, GITLAB_HOST, GITLAB_PROVIDER } from '../server/config'
import { gitlabEmitter } from '../server/events'
import { createGitlabProvider } from '../server/provider'
import { createGitlabServers } from '../server/servers'
import { ciSettledDescription, reviewReceivedDescription, validateReviewReceived } from '../server/policyDescriptions'
import { branchSource, jobSource, mergeRequestSource, reviewCommentSource } from '../shared/sources'
import type { GitlabServerSummary } from '../shared/api'

// GitLab for gitlab.com and company servers (docs/gitlab-integration.md): merge requests as tasks,
// their review views, agent context, workflow CI, and the browser button, on the seams GitHub uses.
//
// Everything past the declarations loads on first use, routes and policy evaluations alike, so a
// Node that never talks to GitLab reads none of it at boot
// (docs/plugin-authoring/the-node-half.md § Load a route on first use).
export const gitlabPlugin = (): NodePlugin => ({
  name: 'gitlab',
  label: 'GitLab',
  required: false,
  // What other plugins may hear from this one (docs/plugins/events.md § Hearing another plugin).
  emits: [
    { verb: 'checks-changed', description: "A merge request's pipeline jobs changed state" },
    { verb: 'pr-synced', description: "A merge request's mirror was committed" },
    { verb: 'pulls-changed', description: "A project's open merge request list was refreshed" },
    { verb: 'repos-changed', description: 'The project mirror changed' },
  ],
  migrationsModule: import.meta.url,
  // Projects whose remote is on gitlab.com are GitLab's (docs/plugins/code-hosts.md), and so are those on
  // each company server a person connects, whose host the plugin claims while the connection exists.
  // GitLab serves every merge request's head at `merge-requests/<n>/head`, a fork's included, and the
  // `mr` pane shows one.
  codeHost: {
    label: 'GitLab',
    hosts: [GITLAB_HOST],
    selfHosted: true,
    changeRequest: {
      ref: 'merge-requests/{number}/head',
      label: 'merge request',
      prefix: '!',
      pane: 'mr',
      api: '/v1/p/gitlab/change-requests',
    },
  },
  // The merge request button on every GitLab server this plugin holds. `{path+}` takes a project path
  // at any group depth.
  browserHandoffs: [
    {
      id: 'merge-request',
      label: 'Open in Acorn',
      match: [
        'https://{codeHost}/{path+}/-/merge_requests/{number}',
        'https://{codeHost}/{path+}/-/merge_requests/{number}/{tab}',
      ],
      // The header's actions on the merge request page. None matching after a redesign is normal: the
      // sidebar still offers the handoff.
      anchors: ['.detail-page-header-actions', '.js-issuable-actions'],
      resolve: '/v1/p/gitlab/browser/merge-request',
    },
  ],
  init: async (ctx) => {
    const store = ctx.storage.open()
    const emit = gitlabEmitter(ctx.events.send)
    const provider = createGitlabProvider({ clientId: gitlabClientId })
    ctx.providers.integration(provider)
    const maxPages = provider.budgets.maxPages

    // Which servers there are and the host each claims, read again whenever a GitLab connection
    // changes. A failed read keeps the last list and is logged.
    const servers = createGitlabServers({
      connections: async () => {
        const owner = ctx.core.identity.active()
        return owner ? ctx.providers.connections(owner, GITLAB_PROVIDER) : []
      },
      claim: (host) => ctx.codeHosts.claim(host),
      forgetOthers: async (ids) => (await import('../server/mirror/projects')).forgetOtherConnections(store, ids),
    })
    const syncServers = () =>
      servers
        .sync()
        .catch((error: unknown) =>
          ctx.log.warn(`could not read the GitLab connections: ${describeError(error).message}`),
        )
    await syncServers()
    ctx.events.on('connection:changed', (frame) => {
      if ((frame as { providerId?: unknown }).providerId === GITLAB_PROVIDER) void syncServers()
    })

    const markers = once(async () =>
      (await import('../server/editorLineMarkers')).mergeRequestEditorLineMarkers(store, ctx.core, servers),
    )
    ctx.extensionPoints.handle(EDITOR_LINE_MARKERS, {
      id: 'merge-request',
      value: { kind: 'pull-request', read: async (...args) => (await markers()).read(...args) },
    })

    // The four sources load on their first request; the descriptors register now.
    ctx.routes.fetch(
      lazyFetch(async () => (await import('../server/data/sources')).createMergeRequestSourceHandler()),
      { prefix: '/data/merge-requests' },
    )
    ctx.dataSources.register(mergeRequestSource)
    ctx.routes.fetch(
      lazyFetch(async () => (await import('../server/data/sources')).createReviewCommentSourceHandler()),
      { prefix: '/data/review-comments' },
    )
    ctx.dataSources.register(reviewCommentSource)
    ctx.routes.fetch(
      lazyFetch(async () => (await import('../server/data/sources')).createJobSourceHandler()),
      {
        prefix: '/data/jobs',
      },
    )
    ctx.dataSources.register(jobSource)
    ctx.routes.fetch(
      lazyFetch(async () =>
        (await import('../server/data/branchSource')).createBranchSourceHandler(ctx.dataSources.invoke),
      ),
      { prefix: '/data/branches' },
    )
    ctx.dataSources.register(branchSource)

    ctx.routes.register(
      new Hono<AppEnv>().get('/', requireDevice, (c) =>
        c.json(servers.all().map(({ host, connectionId }) => ({ host, connectionId })) satisfies GitlabServerSummary[]),
      ),
      { prefix: '/servers', note: 'GET, device only — the connected servers, one per host' },
    )

    // /v1/p/gitlab/projects/* is the mirror, loaded on the first request to it. The reads come before
    // the writes because both declare `/:path/merge-requests/:number/...` paths.
    ctx.routes.register(
      lazyRouter(async () => {
        const [{ projectReads }, { projectWrites }] = await Promise.all([
          import('../server/routes/projectReads'),
          import('../server/routes/projectWrites'),
        ])
        return new Hono<AppEnv>()
          .route('/', projectReads(store, servers, { core: ctx.core, emit, maxPages }))
          .route('/', projectWrites(store, servers, emit))
      }),
      { prefix: '/projects', note: 'project and merge request mirror, by server host' },
    )
    ctx.routes.register(
      lazyRouter(async () =>
        (await import('../server/routes/changeRequests')).changeRequestRoutes(store, ctx.core, servers),
      ),
      { prefix: '/change-requests', note: "a task's merge request for core's agent tools and `pr` context section" },
    )
    ctx.routes.register(
      lazyRouter(async () => (await import('../server/routes/deviceAuth')).gitlabDeviceAuth(gitlabClientId)),
      { prefix: '/auth', note: '/device/* — OAuth device-flow connect' },
    )
    ctx.routes.register(
      lazyRouter(async () => (await import('../server/routes/import')).gitlabImport(store, ctx.core, servers)),
      { prefix: '/import', note: 'POST — import mirrored projects into core projects' },
    )
    ctx.routes.fetch(
      lazyFetch(async () =>
        (await import('../server/browserHandoff')).createBrowserHandoffHandler(store, ctx.core, servers, emit),
      ),
      { prefix: '/browser' },
    )

    // `gitlab:ci-settled` and `gitlab:review-received`, the entry ids `checks-green`, `ci-loop`, and
    // `review-received` ask a task's code host for.
    const policies = once(async () =>
      (await import('../server/workflowPolicies')).gitlabWorkflowPolicies(
        store,
        ctx.core,
        ctx.providers,
        servers,
        emit,
      ),
    )
    ctx.extensionPoints.handle(WORKFLOW_POLICY, {
      id: CODE_HOST_POLICY.ciSettled,
      value: { describe: ciSettledDescription, evaluate: async (run) => (await policies()).ciSettled.evaluate(run) },
    })
    ctx.extensionPoints.handle(WORKFLOW_POLICY, {
      id: CODE_HOST_POLICY.reviewReceived,
      value: {
        describe: reviewReceivedDescription,
        validate: validateReviewReceived,
        evaluate: async (run) => (await policies()).reviewReceived.evaluate(run),
      },
    })

    ctx.capabilities.provide(mirrorFootprintCapability(ctx.name), {
      footprint: async () => (await import('../server/mirrorFootprint')).mirrorFootprint(store),
    })
  },
})

/** A loader that runs once and hands every caller the same answer. */
const once = <T>(load: () => Promise<T>) => {
  let held: Promise<T> | undefined
  return () => (held ??= load())
}
