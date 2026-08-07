import type { TaskSeed } from '@acorn/protocol/api.ts'
import type { SourcePromotionContext } from '@acorn/client-core/registries/sources.ts'
import type { LinearProjectIssue } from '../shared/api'

// Turning a Linear issue into a task seed needs this plugin's wire type, so it belongs to the plugin
// rather than to client-core's shared integrations folder. `TaskSeed` stays in protocol: that is
// core's vocabulary, not Linear's.
export const prepareLinearPromotion = (item: LinearProjectIssue, context: SourcePromotionContext): TaskSeed => ({
  origin: 'linear',
  repoOwner: context.owner,
  repoName: context.repo,
  branch: item.branchName || item.identifier.toLowerCase(),
  title: `${item.identifier} ${item.title}`,
  links: [{ connectionId: item.integrationId, identifier: item.identifier, ref: { displayId: item.identifier, url: item.url } }],
})
