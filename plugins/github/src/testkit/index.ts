// The node half of this package's test seam (docs/architecture-overview.md § Package boundaries).
// Client-side test exports live in ./client.ts, split for the reason @acorn/plugin-api splits its
// own testkit: one barrel carrying both halves puts DOM types into a node-only program.
//
//   apps/node/test/integration/taskContext.test.ts        mirroredPullRequest, the mirror tables
//   apps/node/test/integration/internalPrincipal.test.ts  githubToken
//   apps/node/test/registerProviders.ts                   githubProvider
//
// `seedGithubIntegration` is the older half of the same seam and keeps its own file; this package's
// own route tests import it relatively.
export { githubProvider } from '../server/provider'
export { githubToken } from '../server/githubToken'
export { mirroredPullRequest } from '../server/mirrorQueries'
export { prFiles, pullRequests, repos } from '../node/schema'
export { seedGithubIntegration } from './githubToken'
