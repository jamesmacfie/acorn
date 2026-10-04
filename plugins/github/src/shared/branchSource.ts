import type { DataSourceRegistration } from '@acorn/protocol/dataSources.ts'

export const branchSource: DataSourceRegistration = {
  sourceId: 'local-branches', name: 'Local branches with pull requests', singular: 'Branch', plural: 'Branches',
  providerId: 'github', identityScope: 'Project and local Git ref name',
  handler: '/v1/p/github/data/branches', titlePointer: '/name', icon: 'git-branch',
}
