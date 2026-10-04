import type { DataSourceRegistration } from '@acorn/protocol/dataSources.ts'

export const actionsSource: DataSourceRegistration = {
  sourceId: 'actions-jobs', name: 'GitHub Actions jobs', singular: 'Workflow job', plural: 'Workflow jobs',
  providerId: 'github', identityScope: 'Repository and GitHub job ID, including its run attempt',
  handler: '/v1/p/github/data/actions', titlePointer: '/job', urlPointer: '/url', icon: 'brand:github',
}
