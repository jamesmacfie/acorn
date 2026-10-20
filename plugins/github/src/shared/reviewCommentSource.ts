import type { DataSourceRegistration } from '@acorn/protocol/dataSources.ts'

export const reviewCommentSource: DataSourceRegistration = {
  sourceId: 'review-comments',
  name: 'GitHub review comments',
  singular: 'Review comment',
  plural: 'Review comments',
  providerId: 'github',
  identityScope: 'GitHub GraphQL node ID of the comment or review',
  handler: '/v1/p/github/data/review-comments',
  titlePointer: '/title',
  urlPointer: '/url',
  icon: 'brand:github',
}
