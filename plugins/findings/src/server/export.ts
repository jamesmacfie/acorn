import type { PluginDatabase } from '@acorn/plugin-api/node'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import {
  findingBundles, findingCandidateObservations, findingCandidateRevisions, findingCandidates,
  findingGroupingOutcomes, findingLifecycleCheckpoints, findingPreparationInputs,
  findingPreparationJobs, findingReviewActions, observations,
} from '../node/schema'

export function exportFindings(db: PluginDatabase): unknown {
  return {
    baseline: ACORN_BASELINE,
    version: 1,
    exportedAt: Date.now(),
    observations: db.select().from(observations).all(),
    lifecycleCheckpoints: db.select().from(findingLifecycleCheckpoints).all(),
    candidates: db.select().from(findingCandidates).all(),
    candidateRevisions: db.select().from(findingCandidateRevisions).all(),
    candidateObservations: db.select().from(findingCandidateObservations).all(),
    bundles: db.select().from(findingBundles).all(),
    groupingOutcomes: db.select().from(findingGroupingOutcomes).all(),
    preparationJobs: db.select().from(findingPreparationJobs).all(),
    preparationInputs: db.select().from(findingPreparationInputs).all(),
    reviewHistory: db.select().from(findingReviewActions).all(),
  }
}
