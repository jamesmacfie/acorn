import type { DataSourceRegistration } from '@acorn/protocol/dataSources.ts'

// The data sources GitLab registers (docs/data-sources.md): merge requests, their review comments, and
// pipeline jobs, read from gitlab.com for the projects a panel names, and the local branches beside
// their merge requests.
// What each one describes is in `sourceDescriptions`, which only the handlers load.

export const mergeRequestSource: DataSourceRegistration = {
  sourceId: 'merge-requests',
  name: 'GitLab merge requests',
  singular: 'Merge request',
  plural: 'Merge requests',
  providerId: 'gitlab',
  identityScope: 'Project path and merge request number',
  handler: '/v1/p/gitlab/data/merge-requests',
  titlePointer: '/title',
  urlPointer: '/url',
  icon: 'brand:gitlab',
}

export const reviewCommentSource: DataSourceRegistration = {
  sourceId: 'review-comments',
  name: 'GitLab review comments',
  singular: 'Review comment',
  plural: 'Review comments',
  providerId: 'gitlab',
  identityScope: 'Project address, merge request number, and note ID',
  handler: '/v1/p/gitlab/data/review-comments',
  titlePointer: '/title',
  urlPointer: '/url',
  icon: 'brand:gitlab',
}

export const jobSource: DataSourceRegistration = {
  sourceId: 'pipeline-jobs',
  name: 'GitLab pipeline jobs',
  singular: 'Pipeline job',
  plural: 'Pipeline jobs',
  providerId: 'gitlab',
  identityScope: 'Project path and GitLab job ID',
  handler: '/v1/p/gitlab/data/jobs',
  titlePointer: '/name',
  urlPointer: '/url',
  icon: 'brand:gitlab',
}

export const branchSource: DataSourceRegistration = {
  sourceId: 'local-branches',
  name: 'Local branches with merge requests',
  singular: 'Branch',
  plural: 'Branches',
  providerId: 'gitlab',
  identityScope: 'Project and local Git ref name',
  handler: '/v1/p/gitlab/data/branches',
  titlePointer: '/name',
  icon: 'git-branch',
}
