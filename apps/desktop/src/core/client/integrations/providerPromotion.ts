import type { LinearProjectIssue, RollbarItemSummary, TaskSeed } from '../../shared/api'
import { dedupeBranch, slugifyBranch } from '../../shared/branch'
import type { SourcePromotionContext } from '../registries/sources'

export const prepareLinearPromotion = (item: LinearProjectIssue, context: SourcePromotionContext): TaskSeed => ({
  origin: 'linear',
  repoOwner: context.owner,
  repoName: context.repo,
  branch: item.branchName || item.identifier.toLowerCase(),
  title: `${item.identifier} ${item.title}`,
  links: [{ connectionId: item.integrationId, identifier: item.identifier, ref: { displayId: item.identifier, url: item.url } }],
})

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
