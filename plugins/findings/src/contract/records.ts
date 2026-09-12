import { z } from 'zod'
import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

// One bounds table for every findings ingress. The schemas below use these values, so an agent tool,
// a device route, and a producer-bound writer cannot drift into three different capture contracts.
export const FINDING_LIMITS = {
  titleChars: 200,
  bodyBytes: 16 * 1024,
  evidencePerObservation: 20,
  observationsPerBatch: 100,
  pageSize: 100,
  sourceKeyChars: 200,
  reasonChars: 1_000,
} as const

const boundedUtf8 = (limit: number, label: string) =>
  z.string().refine((value) => new TextEncoder().encode(value).byteLength <= limit, `${label} exceeds ${limit} UTF-8 bytes`)

export const findingScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('task'), taskId: z.string().min(1).max(200) }),
  z.strictObject({ kind: z.literal('project'), projectId: z.string().min(1).max(200) }),
  z.strictObject({ kind: z.literal('workspace'), workspaceId: z.string().min(1).max(200) }),
  z.strictObject({ kind: z.literal('private') }),
])

export type FindingScope = z.infer<typeof findingScopeSchema>

export const findingOriginSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('agent'),
    sessionId: z.string().min(1).max(200),
    turnId: z.string().min(1).max(200).optional(),
    attempt: z.number().int().min(1).optional(),
  }),
  z.strictObject({ kind: z.literal('workflow'), runId: z.string().min(1).max(200), stepId: z.string().min(1).max(200).optional() }),
  z.strictObject({ kind: z.literal('schedule'), scheduleId: z.string().min(1).max(200), runId: z.string().min(1).max(200) }),
  z.strictObject({ kind: z.literal('device'), deviceId: z.string().min(1).max(200) }),
  z.strictObject({ kind: z.literal('plugin'), pluginId: z.string().min(1).max(120), invocationId: z.string().min(1).max(200) }),
  z.strictObject({ kind: z.literal('legacy'), proposalId: z.string().min(1).max(200), sessionId: z.string().min(1).max(200).optional() }),
])

export type FindingOrigin = z.infer<typeof findingOriginSchema>

export const findingEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('repository'), path: z.string().min(1).max(2_000), revision: z.string().min(1).max(200).optional(), label: z.string().min(1).max(200).optional() }),
  z.strictObject({ kind: z.literal('managed-turn'), sessionId: z.string().min(1).max(200), turnId: z.string().min(1).max(200), label: z.string().min(1).max(200).optional() }),
  z.strictObject({ kind: z.literal('workflow-step'), runId: z.string().min(1).max(200), stepId: z.string().min(1).max(200).optional(), label: z.string().min(1).max(200).optional() }),
  z.strictObject({ kind: z.literal('observation'), observationId: z.string().min(1).max(200), label: z.string().min(1).max(200).optional() }),
  z.strictObject({ kind: z.literal('memory-version'), memoryId: z.string().min(1).max(200), hash: z.string().min(1).max(200).optional(), label: z.string().min(1).max(200).optional() }),
  z.strictObject({ kind: z.literal('url'), url: z.url().max(2_048).refine((url) => url.startsWith('https://'), 'evidence URL must use HTTPS'), label: z.string().min(1).max(200) }),
])

export type FindingEvidence = z.infer<typeof findingEvidenceSchema>
export type FindingClaimStatus = 'observed' | 'inferred' | 'asked'

export const findingRecordInputSchema = z.strictObject({
  sourceKey: z.string().trim().min(1).max(FINDING_LIMITS.sourceKeyChars),
  kind: z.string().trim().min(1).max(240).default('findings:observation'),
  kindVersion: z.number().int().min(1).max(1_000).default(1),
  title: z.string().trim().min(1).max(FINDING_LIMITS.titleChars),
  body: boundedUtf8(FINDING_LIMITS.bodyBytes, 'body').refine((body) => body.trim().length > 0, 'body cannot be blank'),
  claimStatus: z.enum(['observed', 'inferred', 'asked']),
  evidence: z.array(findingEvidenceSchema).max(FINDING_LIMITS.evidencePerObservation).default([]),
  correctsObservationId: z.string().min(1).max(200).optional(),
})

export type FindingRecordInput = z.infer<typeof findingRecordInputSchema>

export type FindingKindRef = {
  id: string
  version: number
  label: string
  available: boolean
}

export type FindingWithdrawal = {
  actor: { kind: 'agent' | 'device' | 'plugin'; id: string }
  reason: string | null
  withdrawnAt: number
}

export type FindingObservation = {
  id: string
  scope: FindingScope
  scopeLabels: { task?: string; project?: string; workspace?: string }
  origin: FindingOrigin
  kind: FindingKindRef
  title: string
  body: string
  claimStatus: FindingClaimStatus
  sourceKey: string
  evidence: FindingEvidence[]
  correctsObservationId?: string
  createdAt: number
  withdrawal: FindingWithdrawal | null
}

export type FindingRecordResult = { id: string; created: boolean; revision: number }
export type FindingListPage = { items: FindingObservation[]; nextCursor: string | null; revision: number }

export type FindingListOptions = {
  cursor?: string
  limit?: number
  state?: 'active' | 'history'
}

export type FindingsChangedFrame = {
  channel: 'plugin:findings:observations-changed' | 'plugin:findings:review-changed'
  scope: FindingScope
  revision: number
}

// Read-only on purpose. External recording goes through a producer-bound writer so the contributor
// identity is supplied by the host registration, not by a consumer-controlled argument.
export type FindingsRecordsCapability = {
  listTask(taskId: string, options?: FindingListOptions): Promise<FindingListPage>
  getTask(taskId: string, observationId: string): Promise<FindingObservation | null>
}

export const FINDINGS_RECORDS = capabilityId<FindingsRecordsCapability>('findings.records.v1')
