import { extensionPointId } from '@acorn/protocol/plugin/ids.ts'
import type { FindingRecordInput, FindingRecordResult, FindingScope } from './records'
import type { FindingTargetController } from './review'

export type FindingKindValidationInput = Pick<FindingRecordInput, 'title' | 'body' | 'claimStatus' | 'evidence'>

export type FindingKindDescriptor = {
  version: number
  label: string
  validate?(input: FindingKindValidationInput): void
}

export type FindingWriter = {
  record(scope: FindingScope, input: FindingRecordInput): Promise<FindingRecordResult>
  recordBatch(scope: FindingScope, inputs: readonly FindingRecordInput[]): Promise<FindingRecordResult[]>
}

export type FindingProducerContribution = {
  // Local kind ids owned by this contributor. The findings host qualifies them with the contributing
  // plugin id and refuses every other kind through the bound writer.
  kinds: readonly string[]
  connect(writer: FindingWriter): void | (() => void)
}

/** A legacy owner can lend findings its source bytes without exposing a filesystem path. This is a
 * migration-only read seam: findings parses, hashes, and records the durable mapping in its database. */
export type FindingLegacySource = { filename: string; source: string | null }
export type FindingLegacySourceContribution = {
  version: 1
  list(): Promise<readonly FindingLegacySource[]>
}

export type FindingReviewValidation = {
  payload: unknown
  payloadHash: string
  fingerprint: string
  subjectKey: string
  warnings: string[]
  base?: { targetId: string; hash: string; payload: unknown }
}

/** A target validates its own payload and receives a revocable, owner-bound completion handle.
 * Findings can prepare review state through this seam, but never receives target write authority. */
export type FindingReviewTargetContribution = {
  version: number
  validate(input: { scope: FindingScope; payload: unknown }): Promise<FindingReviewValidation>
  acceptedFingerprints(scope: FindingScope): Promise<readonly string[]>
  connect(controller: FindingTargetController): void | (() => void)
}

export const FINDINGS_KIND = extensionPointId<FindingKindDescriptor>('findings:kind')
export const FINDINGS_PRODUCER = extensionPointId<FindingProducerContribution>('findings:producer')
export const FINDINGS_REVIEW_TARGET = extensionPointId<FindingReviewTargetContribution>('findings:review-target')
export const FINDINGS_LEGACY_SOURCE = extensionPointId<FindingLegacySourceContribution>('findings:legacy-source')
