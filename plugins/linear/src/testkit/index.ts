// The test seam for this package (docs/architecture-overview.md § Package boundaries).
//
//   apps/node/test/integration/linear.test.ts   everything below
//   apps/node/test/registerProviders.ts         linearProvider, createLinearFetch
//
// `linearFetch` is re-exported for the test's imports, but the test still mocks the module it lives
// in by its own path — a `vi.mock` has to name the module the code under test imports, and linear's
// routes import `../index` relatively. That is why `./server/index.ts` stays in this package's
// `exports` map alongside this file.
export { linearFetch, type LinearNode } from '../server/index'
export { linearProvider, linearRef } from '../server/provider'
export { createLinearFetch } from '../server/routes/linear'
export type { LinearIssueDetail, LinearIssueSummary, LinearProjectIssuesResponse } from '../shared/api'
