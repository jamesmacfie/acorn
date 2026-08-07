import type { LinearProjectIssue, TaskSeed } from '@acorn/protocol/api.ts'
import type { SourcePromotionContext } from '../registries/sources'

export const prepareLinearPromotion = (item: LinearProjectIssue, context: SourcePromotionContext): TaskSeed => ({
  origin: 'linear',
  repoOwner: context.owner,
  repoName: context.repo,
  branch: item.branchName || item.identifier.toLowerCase(),
  title: `${item.identifier} ${item.title}`,
  links: [{ connectionId: item.integrationId, identifier: item.identifier, ref: { displayId: item.identifier, url: item.url } }],
})
