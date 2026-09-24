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


export type FindingReviewValidation = {
  payload: unknown
  payloadHash: string
  fingerprint: string
  subjectKey: string
  warnings: string[]
  base?: { targetId: string; hash: string; payload: unknown }
}

export type FindingReviewSynthesisContext = {
  /** Target-owned instructions for producing one valid review payload. */
  instructions: string
  /** A bounded snapshot of accepted targets, used to prefer updates and avoid semantic duplicates. */
  existing: unknown[]
}

/** A target validates its own payload and receives a revocable, owner-bound completion handle.
 * Findings can prepare review state through this seam, but never receives target write authority. */
export type FindingReviewTargetContribution = {
  version: number
  /** Human-readable name for target selection. Falls back to the qualified ID. */
  label?: string
  /** Must be side-effect free. Findings may call validation while correcting generated payloads and
   * calls it again before persisting a candidate. */
  validate(input: { scope: FindingScope; payload: unknown }): Promise<FindingReviewValidation>
  acceptedFingerprints(scope: FindingScope): Promise<readonly string[]>
  synthesisContext?(scope: FindingScope): Promise<FindingReviewSynthesisContext>
  connect(controller: FindingTargetController): void | (() => void)
}

export const FINDINGS_KIND = extensionPointId<FindingKindDescriptor>('findings:kind')
export const FINDINGS_PRODUCER = extensionPointId<FindingProducerContribution>('findings:producer')
export const FINDINGS_REVIEW_TARGET = extensionPointId<FindingReviewTargetContribution>('findings:review-target')
