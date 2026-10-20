// The node half of this package's test seam (docs/architecture/packages.md § Package boundaries).
// Client-side test exports live in ./client.ts, split for the reason @acorn/plugin-api splits its
// own testkit: one barrel carrying both halves puts DOM types into a node-only program.
//
//   apps/node/test/integration/taskContext.test.ts             mirror tables, changeRequestRoutes
//   apps/node/test/integration/auth/internalPrincipal.test.ts  githubToken
//   apps/node/test/helpers/registerProviders.ts                githubProvider
//
// `seedGithubIntegration` keeps its own file; this package's own route tests import it relatively.
export { githubProvider } from '../server/provider'
export { githubToken } from '../server/githubToken'
export { checks, prFiles, pullRequests, repos } from '../node/schema'
export { seedGithubIntegration } from './githubToken'
export { changeRequestRoutes } from '../server/routes/changeRequests'
// Node source composition test in apps/node/test/integration/githubDataSource.test.ts.
export { createPullSourceHandler } from '../server/data/pullSourceHandler'
export { pullSource } from '../shared/pullSource'
export { createIssueSourceHandler } from '../server/data/issueSourceHandler'
export { issueSource } from '../shared/issueSource'
export { issueSourceDescription } from '../shared/issueSourceDescription'
export { createReviewCommentSourceHandler } from '../server/data/reviewCommentSourceHandler'
export { reviewCommentSource } from '../shared/reviewCommentSource'
export { reviewCommentSourceDescription } from '../shared/reviewCommentSourceDescription'
export { createBranchSourceHandler } from '../server/data/branchSourceHandler'
export { branchSource } from '../shared/branchSource'
