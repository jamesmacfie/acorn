import { Hono } from 'hono'
import {
  describeError,
  lazyFetch,
  lazyRouter,
  mirrorFootprintCapability,
  type AppEnv,
  type NodePlugin,
} from '@acorn/plugin-api/node'
import { EDITOR_LINE_MARKERS } from '@acorn/plugin-editor/contract/lineMarkers.ts'
import { CODE_HOST_POLICY, WORKFLOW_POLICY } from '@acorn/plugin-workflows/contract/extensions.ts'
import { bitbucketEmitter } from '../server/events'
import { bitbucketProvider } from '../server/provider'
import { BITBUCKET_PROVIDER } from '../server/config'
import { createBitbucketAccount } from '../server/account'
import { ciSettledDescription, reviewReceivedDescription, validateReviewReceived } from '../server/policyDescriptions'
import { BITBUCKET_HOST, PULL_REQUEST_PAGES } from '../shared/pullRequestRef'
import { pullRequestSource, stepSource } from '../shared/sources'

// Bitbucket Cloud (docs/bitbucket-integration.md): pull requests as tasks, their review views, agent
// context, workflow CI, and the browser button, on the seams GitHub and GitLab use.
//
// Everything past the declarations loads on first use, routes and policy evaluations alike, so a
// Node that never talks to Bitbucket reads none of it at boot
// (docs/plugin-authoring/the-node-half.md § Load a route on first use).
export const bitbucketPlugin = (): NodePlugin => ({
  name: 'bitbucket',
  label: 'Bitbucket',
  required: false,
  // What other plugins may hear from this one (docs/plugins/events.md § Hearing another plugin).
  // workflows hears `checks-changed`.
  emits: [
    { verb: 'checks-changed', description: "A pull request's build statuses changed state" },
    { verb: 'pr-synced', description: "A pull request's mirror was committed" },
    { verb: 'pulls-changed', description: "A repository's open pull request list was refreshed" },
    { verb: 'repos-changed', description: 'The repository mirror changed' },
  ],
  migrationsModule: import.meta.url,
  // Projects whose remote is on bitbucket.org are Bitbucket's (docs/plugins/code-hosts.md). Bitbucket
  // publishes no ref for a pull request, so core fetches its source branch by name, from the fork when
  // the link names one (docs/plugins/code-hosts.md § Forks without a ref). The pane id is
  // `bitbucket-pr` because pane ids are global and `pr` is GitHub's.
  codeHost: {
    label: 'Bitbucket',
    hosts: [BITBUCKET_HOST],
    changeRequest: {
      label: 'pull request',
      prefix: '#',
      pane: 'bitbucket-pr',
      api: '/v1/p/bitbucket/change-requests',
    },
  },
  browserHandoffs: [
    {
      id: 'pull-request',
      label: 'Open in Acorn',
      match: PULL_REQUEST_PAGES,
      // Bitbucket's pull request header. Not checked against bitbucket.org's current markup; when none
      // matches, the sidebar still offers the handoff.
      anchors: ['[data-testid="pr-header-actions"]', '[data-qa="pr-header-actions"]'],
      resolve: '/v1/p/bitbucket/browser/pull-request',
    },
  ],
  init: async (ctx) => {
    const store = ctx.storage.open()
    const emit = bitbucketEmitter(ctx.events.send)
    ctx.providers.integration(bitbucketProvider)
    const maxPages = bitbucketProvider.budgets.maxPages

    // The one connection the mirror and every call use, read again whenever it changes. A failed read
    // keeps the last answer and is logged.
    const account = createBitbucketAccount({
      connections: async () => {
        const owner = ctx.core.identity.active()
        return owner ? ctx.providers.connections(owner, BITBUCKET_PROVIDER) : []
      },
      forgetOthers: async (ids) => (await import('../server/mirror/repositories')).forgetOtherConnections(store, ids),
    })
    const syncAccount = () =>
      account
        .sync()
        .catch((error: unknown) =>
          ctx.log.warn(`could not read the Bitbucket connection: ${describeError(error).message}`),
        )
    await syncAccount()
    ctx.events.on('connection:changed', (frame) => {
      if ((frame as { providerId?: unknown }).providerId === BITBUCKET_PROVIDER) void syncAccount()
    })

    const markers = once(async () =>
      (await import('../server/editorLineMarkers')).pullRequestEditorLineMarkers(store, ctx.core, account),
    )
    ctx.extensionPoints.handle(EDITOR_LINE_MARKERS, {
      id: 'pull-request',
      value: { kind: 'pull-request', read: async (...args) => (await markers()).read(...args) },
    })

    // The two sources load on their first request; the descriptors register now.
    ctx.routes.fetch(
      lazyFetch(async () => (await import('../server/data/sources')).createPullRequestSourceHandler()),
      { prefix: '/data/pull-requests' },
    )
    ctx.dataSources.register(pullRequestSource)
    ctx.routes.fetch(
      lazyFetch(async () => (await import('../server/data/sources')).createStepSourceHandler()),
      { prefix: '/data/steps' },
    )
    ctx.dataSources.register(stepSource)

    // /v1/p/bitbucket/repositories/* is the mirror, loaded on the first request to it. The reads come
    // before the writes because both declare `/:workspace/:repo/pull-requests/:number/...` paths.
    ctx.routes.register(
      lazyRouter(async () => {
        const [{ repositoryReads }, { repositoryWrites }] = await Promise.all([
          import('../server/routes/repositoryReads'),
          import('../server/routes/repositoryWrites'),
        ])
        return new Hono<AppEnv>()
          .route('/', repositoryReads(store, account, { core: ctx.core, emit, maxPages }))
          .route('/', repositoryWrites(store, account, emit))
      }),
      { prefix: '/repositories', note: 'repository and pull request mirror' },
    )
    ctx.routes.register(
      lazyRouter(async () =>
        (await import('../server/routes/changeRequests')).changeRequestRoutes(store, ctx.core, account),
      ),
      { prefix: '/change-requests', note: "a task's pull request for core's agent tools and `pr` context section" },
    )
    ctx.routes.register(
      lazyRouter(async () => (await import('../server/routes/import')).bitbucketImport(store, ctx.core, account)),
      { prefix: '/import', note: 'POST — import mirrored repositories into core projects' },
    )
    ctx.routes.fetch(
      lazyFetch(async () =>
        (await import('../server/browserHandoff')).createBrowserHandoffHandler(store, ctx.core, emit),
      ),
      { prefix: '/browser' },
    )

    // `bitbucket:ci-settled` and `bitbucket:review-received`, the entry ids `checks-green`, `ci-loop`,
    // and `review-received` ask a task's code host for.
    const policies = once(async () =>
      (await import('../server/workflowPolicies')).bitbucketWorkflowPolicies(
        store,
        ctx.core,
        ctx.providers,
        account,
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
