import type { DataSourceRegistration } from '@acorn/protocol/dataSources.ts'

export const issueSource: DataSourceRegistration = {
  sourceId: 'issues',
  name: 'GitHub issues',
  singular: 'Issue',
  plural: 'Issues',
  providerId: 'github',
  identityScope: 'GitHub GraphQL node ID; stable across titles, transfers, and repository renames',
  handler: '/v1/p/github/data/issues',
  titlePointer: '/title',
  urlPointer: '/url',
  icon: 'brand:github',
}
