import type { DataSourceRegistration } from '@acorn/protocol/dataSources.ts'

// The Node's boot loads this. The description loads with its handler on the first read, which keeps it
// out of the service's boot budget (apps/node/scripts/check-service-budget.mjs).
export const commitSource: DataSourceRegistration = {
  sourceId: 'commits',
  name: 'Git commits',
  singular: 'Commit',
  plural: 'Commits',
  identityScope: 'Project and commit ID; one record per commit per project',
  handler: '/v1/p/git/data/commits',
  titlePointer: '/subject',
  icon: 'git-commit-horizontal',
}
