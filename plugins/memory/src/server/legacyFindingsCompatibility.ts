import type { FindingsLegacyMapping, FindingsMigrationReport } from '@acorn/plugin-findings/contract/lifecycle.ts'
import type { FindingCandidateRevision } from '@acorn/plugin-findings/contract/review.ts'
import type { MemoryProposalStore } from './memoryProposals'

type Result = { ok: boolean; state?: string; targetReference?: string; reason?: string }

export type LegacyFindingsCompatibility = {
  migrationReport(): Promise<FindingsMigrationReport>
  mapping(legacyId: string): Promise<FindingsLegacyMapping | null>
  dismiss(legacyId: string, actorId: string): Promise<boolean>
  candidate(candidateId: string): Promise<FindingCandidateRevision | null>
  approve(input: { candidateId: string; revision: number; payloadHash: string; idempotencyKey: string; deviceId: string }): Promise<Result>
  proposals: Pick<MemoryProposalStore, 'get' | 'resolve'>
}

const changedReason = 'This proposal changed. Open its Findings preview before deciding.'

const repairLegacyStatus = async (
  proposals: LegacyFindingsCompatibility['proposals'],
  legacyId: string,
  status: 'accepted' | 'rejected',
): Promise<Result> => {
  const proposal = await proposals.get(legacyId)
  if (!proposal) return { ok: true }
  if (proposal.status === status) return { ok: true }
  if (proposal.status !== 'pending') return { ok: false, reason: 'This legacy proposal already has a different decision.' }
  const repaired = await proposals.resolve(legacyId, status)
  return repaired?.status === status ? { ok: true } : { ok: false, reason: 'The legacy proposal status could not be repaired.' }
}

// During the compatibility period the Findings candidate is authoritative, while the retained JSON
// status is a durable fallback mirror. Findings is completed first; if the atomic JSON replacement
// fails, the request fails and the same device action can safely repair only the missing link.
export const resolveMappedLegacyProposal = async (
  input: { id: string; approved: boolean; edited?: unknown; deviceId?: string },
  deps: LegacyFindingsCompatibility,
): Promise<Result | null> => {
  if (!(await deps.migrationReport()).cutoverReady) return null
  const entry = await deps.mapping(input.id)
  if (!entry?.oneToOne || !entry.candidateId || !entry.candidateRevision || !entry.candidatePayloadHash) return null
  if (input.edited) return { ok: false, reason: 'This proposal moved to Findings. Open its current preview before editing.' }
  if (!input.deviceId) return { ok: false, reason: 'A device identity is required.' }

  const proposal = await deps.proposals.get(input.id)
  const desiredStatus = input.approved ? 'accepted' : 'rejected'
  if (proposal && proposal.status !== 'pending' && proposal.status !== desiredStatus) {
    return { ok: false, reason: 'This legacy proposal already has a different decision.' }
  }

  if (!input.approved) {
    if (!(await deps.dismiss(input.id, input.deviceId))) return { ok: false, reason: changedReason }
    const repaired = await repairLegacyStatus(deps.proposals, input.id, 'rejected')
    return repaired.ok ? { ok: true } : repaired
  }

  const candidate = await deps.candidate(entry.candidateId)
  if (!candidate || candidate.revision !== entry.candidateRevision || candidate.payloadHash !== entry.candidatePayloadHash
    || candidate.sourceObservationIds.length !== 1 || candidate.sourceObservationIds[0] !== entry.observationId) {
    return { ok: false, reason: 'This proposal changed. Open its Findings preview before approving.' }
  }
  const approved = await deps.approve({
    candidateId: candidate.candidateId,
    revision: candidate.revision,
    payloadHash: candidate.payloadHash,
    idempotencyKey: `legacy-approve:${input.id}:${candidate.revision}`,
    deviceId: input.deviceId,
  })
  if (!approved.ok) return approved
  const repaired = await repairLegacyStatus(deps.proposals, input.id, 'accepted')
  return repaired.ok ? approved : repaired
}
