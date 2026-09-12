import { capabilityId } from '@acorn/protocol/plugin/ids.ts'
import { z } from 'zod'
import type { FindingObservation, FindingScope } from './records'

export const FINDING_CANDIDATE_PAYLOAD_BYTES = 64 * 1024
export const findingCandidateStatusSchema = z.enum(['draft', 'ready', 'snoozed', 'dismissed', 'applying', 'applied', 'conflict', 'superseded'])
export type FindingCandidateStatus = z.infer<typeof findingCandidateStatusSchema>

export type FindingCandidateRevision = {
  candidateId: string
  revision: number
  targetKind: string
  targetVersion: number
  scope: FindingScope
  payload: unknown
  sourceObservationIds: string[]
  payloadHash: string
  fingerprint: string
  subjectKey: string
  groupingExplanation: string
  warnings: string[]
  base: { targetId: string; hash: string; payload: unknown } | null
  status: FindingCandidateStatus
  snoozedUntil: number | null
  createdAt: number
  updatedAt: number
}

export type FindingGroupingOutcome = {
  observationId: string
  outcome: 'candidate' | 'duplicate' | 'already-covered' | 'suppressed' | 'not-selected'
  candidateId: string | null
  explanation: string
}

export type FindingBundle = {
  id: string
  scope: FindingScope
  boundaryKey: string
  revision: number
  state: 'preparing' | 'ready' | 'failed' | 'cancelled'
  backendId: string | null
  modelId: string | null
  candidates: FindingCandidateRevision[]
  outcomes: FindingGroupingOutcome[]
  inputCount: number
  pendingCount: number
  createdAt: number
  updatedAt: number
  error: string | null
}

export type FindingReviewHistory = {
  id: string
  candidateId: string
  expectedRevision: number
  actorId: string
  action: 'edit' | 'dismiss' | 'dismiss-reason' | 'undo-dismiss' | 'snooze' | 'restore' | 'split' | 'applying' | 'applied' | 'conflict'
  reason: string | null
  createdAt: number
}

export type FindingPreparationRequest = {
  scope: FindingScope
  boundaryKey: string
  backendId?: string
  modelId?: string
}

export type FindingTargetController = {
  applying(candidateId: string, revision: number, operationId: string): Promise<FindingCandidateRevision>
  applied(candidateId: string, revision: number, operationId: string, targetReference: string): Promise<FindingCandidateRevision>
  conflict(candidateId: string, revision: number, operationId: string, reason: string): Promise<FindingCandidateRevision>
}

export type FindingsReviewCapability = {
  candidate(candidateId: string, revision?: number): Promise<FindingCandidateRevision | null>
  bundles(scope: FindingScope, includeHistory?: boolean): Promise<FindingBundle[]>
  observations(ids: readonly string[]): Promise<FindingObservation[]>
}

export const FINDINGS_REVIEW = capabilityId<FindingsReviewCapability>('findings.review.v1')

const scopeQuery = (scope: FindingScope): string => scope.kind === 'private' ? 'scope=private'
  : scope.kind === 'task' ? `scope=task&taskId=${encodeURIComponent(scope.taskId)}`
    : scope.kind === 'project' ? `scope=project&projectId=${encodeURIComponent(scope.projectId)}`
      : `scope=workspace&workspaceId=${encodeURIComponent(scope.workspaceId)}`
export const findingsBundlesRoute = (scope: FindingScope, history = false): string => `/v2/p/findings/review/bundles?${scopeQuery(scope)}${history ? '&history=true' : ''}`
export const findingsPrepareRoute = (taskId: string): string => `/v2/p/findings/tasks/${encodeURIComponent(taskId)}/review/prepare`
export const findingsCandidateRoute = (id: string): string => `/v2/p/findings/review/candidates/${encodeURIComponent(id)}`
export const findingsCandidateEditRoute = (id: string): string => `${findingsCandidateRoute(id)}/edit`
export const findingsCandidateDecisionRoute = (id: string): string => `${findingsCandidateRoute(id)}/decision`
export const findingsCandidateHistoryRoute = (id: string): string => `${findingsCandidateRoute(id)}/history`
export const findingsCancelPreparationRoute = (bundleId: string): string => `/v2/p/findings/review/bundles/${encodeURIComponent(bundleId)}/cancel`
export const findingsRetryPreparationRoute = (bundleId: string): string => `/v2/p/findings/review/bundles/${encodeURIComponent(bundleId)}/retry`
export const findingsRestoreObservationRoute = (bundleId: string, observationId: string): string => `/v2/p/findings/review/bundles/${encodeURIComponent(bundleId)}/outcomes/${encodeURIComponent(observationId)}/restore`
export const findingsSplitCandidateRoute = (candidateId: string): string => `${findingsCandidateRoute(candidateId)}/split`
