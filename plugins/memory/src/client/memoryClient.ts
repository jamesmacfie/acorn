// The client's memory surface (docs/notes-and-memory.md). Was the `window.acorn.memory` preload
// bridge, now loopback HTTP. Backed by the node's memory index, so it 503s in dev:node.
import { memoryAddRoute, memoryApproveFindingRoute, memoryListRoute, memorySearchRoute } from '../shared/api'
import { readJson, writeJson } from '@acorn/plugin-api/client'
import {
  findingsBundlesRoute, findingsCancelPreparationRoute, findingsCandidateDecisionRoute, findingsCandidateEditRoute, findingsCandidateHistoryRoute,
  findingsCandidateRoute, findingsDismissBundleRoute, findingsPrepareRoute, findingsRestoreObservationRoute, findingsRetryPreparationRoute, findingsReviewAttentionRoute, findingsSplitCandidateRoute, type FindingBundle, type FindingCandidateRevision, type FindingReviewAttention, type FindingReviewHistory,
} from '@acorn/plugin-findings/contract/review.ts'
import type { FindingObservation, FindingScope } from '@acorn/plugin-findings/contract/records.ts'
import { findingsSettingsRoute, type FindingsReviewSettings } from '@acorn/plugin-findings/contract/lifecycle.ts'
import type { MemoryChangePayload } from '../contract/findingsReview'

export type MemoryType = 'convention' | 'architecture' | 'decision' | 'fix' | 'reference' | 'feedback' | 'task' | 'user'

export type MemoryRow = {
  id: string
  scope: 'project' | 'private'
  projectId: string | null
  name: string
  type: MemoryType
  description: string
  body: string
  path: string
  originSessionId: string | null
  commitSha: string | null
  supersededBy: string | null
  createdAt: number
  updatedAt: number
}

export type MemoryApi = {
  list(projectId?: string): Promise<MemoryRow[] | { error: string }>
  search(query: string, projectId?: string, type?: MemoryType): Promise<(MemoryRow & { rank: number })[] | { error: string }>
  add(p: { taskId: string; scope: 'project' | 'private'; name: string; description: string; type: MemoryType; body: string }): Promise<{ path: string } | { error: string }>
  bundles(scope: FindingScope, history?: boolean): Promise<FindingBundle[]>
  reviewAttention(options?: { nodeId?: string; signal?: AbortSignal }): Promise<FindingReviewAttention[]>
  reviewSettings(): Promise<FindingsReviewSettings>
  finding(id: string): Promise<FindingCandidateRevision & { observations: FindingObservation[] }>
  prepare(taskId: string, boundaryKey: string): Promise<FindingBundle>
  editFinding(id: string, expectedRevision: number, payload: MemoryChangePayload, idempotencyKey: string): Promise<FindingCandidateRevision>
  decideFinding(id: string, input: { expectedRevision: number; action: 'dismiss' | 'dismiss-reason' | 'undo-dismiss' | 'snooze'; reason?: string; until?: number; idempotencyKey: string }): Promise<FindingCandidateRevision>
  findingHistory(id: string): Promise<{ items: FindingReviewHistory[] }>
  approveFinding(id: string, revision: number, payloadHash: string, idempotencyKey: string): Promise<{ ok: boolean; state?: string; targetReference?: string; reason?: string }>
  cancelPreparation(bundleId: string): Promise<FindingBundle>
  dismissBundle(bundleId: string, idempotencyKey: string, reason?: string): Promise<FindingBundle>
  retryPreparation(bundleId: string): Promise<FindingBundle>
  restoreFindingObservation(bundleId: string, observationId: string, candidateId: string, expectedRevision: number, idempotencyKey: string): Promise<FindingBundle>
  splitFinding(candidateId: string, bundleId: string, expectedRevision: number, observationIds: string[], idempotencyKey: string): Promise<FindingBundle>
}

const post = <T>(url: string, body?: unknown) =>
  writeJson<T>(url, { method: 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

const api: MemoryApi = {
  list: (projectId) => readJson<MemoryRow[] | { error: string }>(memoryListRoute(projectId)),
  search: (query, projectId, type) => readJson<(MemoryRow & { rank: number })[] | { error: string }>(memorySearchRoute(query, projectId, type)),
  add: (p) => post<{ path: string } | { error: string }>(memoryAddRoute(p.taskId), { scope: p.scope, name: p.name, description: p.description, type: p.type, body: p.body }),
  bundles: (scope, history) => readJson<FindingBundle[]>(findingsBundlesRoute(scope, history)),
  reviewAttention: (options) => readJson<FindingReviewAttention[]>(findingsReviewAttentionRoute, options ?? {}),
  reviewSettings: () => readJson<FindingsReviewSettings>(findingsSettingsRoute),
  finding: (id) => readJson<FindingCandidateRevision & { observations: FindingObservation[] }>(findingsCandidateRoute(id)),
  prepare: (taskId, boundaryKey) => post<FindingBundle>(findingsPrepareRoute(taskId), { boundaryKey, targetId: 'memory:change' }),
  editFinding: (id, expectedRevision, payload, idempotencyKey) => post<FindingCandidateRevision>(findingsCandidateEditRoute(id), { expectedRevision, payload, idempotencyKey }),
  decideFinding: (id, input) => post<FindingCandidateRevision>(findingsCandidateDecisionRoute(id), input),
  findingHistory: (id) => readJson<{ items: FindingReviewHistory[] }>(findingsCandidateHistoryRoute(id)),
  approveFinding: (id, revision, payloadHash, idempotencyKey) => post<{ ok: boolean; state?: string; targetReference?: string; reason?: string }>(memoryApproveFindingRoute(id), { revision, payloadHash, idempotencyKey }),
  cancelPreparation: (bundleId) => post<FindingBundle>(findingsCancelPreparationRoute(bundleId)),
  dismissBundle: (bundleId, idempotencyKey, reason) => post<FindingBundle>(findingsDismissBundleRoute(bundleId), { idempotencyKey, ...(reason ? { reason } : {}) }),
  retryPreparation: (bundleId) => post<FindingBundle>(findingsRetryPreparationRoute(bundleId)),
  restoreFindingObservation: (bundleId, observationId, candidateId, expectedRevision, idempotencyKey) => post<FindingBundle>(findingsRestoreObservationRoute(bundleId, observationId), { candidateId, expectedRevision, idempotencyKey }),
  splitFinding: (candidateId, bundleId, expectedRevision, observationIds, idempotencyKey) => post<FindingBundle>(findingsSplitCandidateRoute(candidateId), { bundleId, expectedRevision, observationIds, idempotencyKey }),
}

export const memoryApi = (): MemoryApi => api
