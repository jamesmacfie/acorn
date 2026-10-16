import type { DataSourceRegistration } from '@acorn/protocol/dataSources.ts'

// The data sources Bitbucket registers (docs/data-sources.md): pull requests and Pipelines steps, read
// from bitbucket.org for the repositories a panel names. What each one describes is in
// `sourceDescriptions`, which only the handlers load.

export const pullRequestSource: DataSourceRegistration = {
  sourceId: 'pull-requests',
  name: 'Bitbucket pull requests',
  singular: 'Pull request',
  plural: 'Pull requests',
  providerId: 'bitbucket',
  identityScope: 'Repository full name and pull request number',
  handler: '/v1/p/bitbucket/data/pull-requests',
  titlePointer: '/title',
  urlPointer: '/url',
  icon: 'brand:bitbucket',
}

export const stepSource: DataSourceRegistration = {
  sourceId: 'pipeline-steps',
  name: 'Bitbucket Pipelines steps',
  singular: 'Pipeline step',
  plural: 'Pipeline steps',
  providerId: 'bitbucket',
  identityScope: 'Repository full name and step UUID',
  handler: '/v1/p/bitbucket/data/steps',
  titlePointer: '/name',
  urlPointer: '/url',
  icon: 'brand:bitbucket',
}
