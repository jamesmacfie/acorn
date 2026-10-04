import type { DataSourceRegistration } from '@acorn/protocol/dataSources.ts'

export const pullSource: DataSourceRegistration = {
  sourceId: 'pull-requests', name: 'GitHub pull requests', singular: 'Pull request', plural: 'Pull requests',
  providerId: 'github', identityScope: 'GitHub GraphQL node ID; stable across titles and repository renames',
  handler: '/v1/p/github/data/pulls', titlePointer: '/title', urlPointer: '/url', icon: 'brand:github',
}
