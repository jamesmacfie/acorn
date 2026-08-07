import type { TaskSeed } from '@acorn/protocol/api.ts'
import { dedupeBranch, slugifyBranch } from '@acorn/protocol/branch.ts'
import type { SourcePromotionContext } from '@acorn/client-core/registries/sources.ts'
import type { RollbarItemSummary } from '../shared/api'

// Turning a Rollbar item into a task seed needs this plugin's wire type, so it belongs to the plugin
// rather than to client-core's shared integrations folder. `TaskSeed` and the branch helpers stay in
// protocol: those are core's vocabulary, not Rollbar's.
export const prepareRollbarPromotion = (item: RollbarItemSummary, context: SourcePromotionContext): TaskSeed => ({
  origin: 'rollbar',
  repoOwner: context.owner,
  repoName: context.repo,
  branch: slugifyBranch(context.branch ?? '') || dedupeBranch(
    slugifyBranch(`fix ${item.title}`.slice(0, 50)) || `fix-rollbar-${item.identifier}`,
    context.existingBranches ?? [],
  ),
  title: item.title.slice(0, 120),
  // Retain the canonical system id on the link so detail fetches skip counter resolution (legacy
  // counter-only links still resolve — see server/provider.ts).
  links: [{ connectionId: item.integrationId, identifier: item.identifier, ref: { displayId: item.identifier, ...(item.itemId ? { externalId: item.itemId } : {}) } }],
})
