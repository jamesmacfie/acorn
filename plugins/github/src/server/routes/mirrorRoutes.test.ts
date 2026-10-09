import { expect, it } from 'vitest'
import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import { NO_EMIT } from '../events'
import { mirrorRoutes } from './mirrorRoutes'

// Hono matches in registration order, and several of these paths overlap, so the order is part of
// the contract. The node's route golden (apps/node/test/integration/routeRegistry.snapshot.json) only
// sees the one lazy mount over /repos, so this list is what notices a router going missing or moving.
const MIRROR_ROUTES = [
  'GET /',
  'POST /refresh',
  'GET /:owner/:repo/labels',
  'GET /:owner/:repo/pulls',
  'GET /:owner/:repo/pulls/search',
  'GET /:owner/:repo/pulls/:number',
  'GET /:owner/:repo/pulls/:number/conflicts',
  'GET /:owner/:repo/pulls/:number/files',
  'GET /:owner/:repo/pulls/:number/diff',
  'GET /:owner/:repo/blobs/:sha',
  'POST /:owner/:repo/diff/segments',
  'POST /:owner/:repo/diff/search',
  'POST /:owner/:repo/pulls/batch',
  'POST /:owner/:repo/pulls/:number/merge',
  'POST /:owner/:repo/pulls/:number/auto-merge',
  'DELETE /:owner/:repo/pulls/:number/auto-merge',
  'POST /:owner/:repo/pulls/:number/:action{close|reopen}',
  'POST /:owner/:repo/pulls/:number/draft',
  'POST /:owner/:repo/pulls/:number/comments',
  'POST /:owner/:repo/pulls/:number/labels',
  'DELETE /:owner/:repo/pulls/:number/labels',
  'POST /:owner/:repo/pulls/:number/viewed',
  'POST /:owner/:repo/pulls/:number/review-comments',
  'POST /:owner/:repo/pulls/:number/review-comments/:commentId/replies',
  'POST /:owner/:repo/pulls/:number/threads/:threadId/resolve',
  'POST /:owner/:repo/pulls/:number/reviews',
  'POST /:owner/:repo/pulls/:number/requested-reviewers',
  'DELETE /:owner/:repo/pulls/:number/requested-reviewers',
  'POST /:owner/:repo/actions/:runId/rerun',
  'GET /:owner/:repo/actions/runs/:runId/jobs',
  'GET /:owner/:repo/actions/jobs/:jobId/logs',
  'GET /:owner/:repo/branches',
  'GET /:owner/:repo/compare',
  'POST /:owner/:repo/pulls',
  'GET /:owner/:repo/mentions',
]

it('builds the mirror routers in their matching order', () => {
  // Construction reads neither handle; the handlers do, and they don't run here.
  const routes = mirrorRoutes({} as PluginDatabase, {} as CoreServices, NO_EMIT).routes
  expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual(MIRROR_ROUTES)
})
