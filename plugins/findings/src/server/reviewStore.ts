import { createHash, randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { FindingObservation, FindingScope } from '../contract/records'
import type { FindingBundle, FindingCandidateRevision, FindingGroupingOutcome, FindingReviewHistory } from '../contract/review'
import {
  findingBundleCandidates, findingBundles, findingCandidateObservations, findingCandidateRevisions,
  findingCandidates, findingGroupingOutcomes, findingPreparationInputs, findingPreparationJobs, findingReviewActions, findingSuppressions,
} from '../node/schema'
import type { FindingReviewTargetContribution, FindingReviewValidation } from '../contract/extensions'
import { FindingCaptureError } from './capture'

export const reviewScopeKey = (scope: FindingScope): string => scope.kind === 'private' ? 'private'
  : scope.kind === 'task' ? `task:${scope.taskId}` : scope.kind === 'project' ? `project:${scope.projectId}` : `workspace:${scope.workspaceId}`
const normalized = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase()
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const scopeWhere = (scope: FindingScope) => and(
  eq(findingCandidates.scopeKind, scope.kind),
  scope.kind === 'task' ? eq(findingCandidates.taskId, scope.taskId) : isNull(findingCandidates.taskId),
  scope.kind === 'project' ? eq(findingCandidates.projectId, scope.projectId) : isNull(findingCandidates.projectId),
  scope.kind === 'workspace' ? eq(findingCandidates.workspaceId, scope.workspaceId) : isNull(findingCandidates.workspaceId),
)
const storedScope = (row: { scopeKind: string; taskId: string | null; projectId: string | null; workspaceId: string | null }): FindingScope => row.scopeKind === 'task'
  ? { kind: 'task', taskId: row.taskId! } : row.scopeKind === 'project' ? { kind: 'project', projectId: row.projectId! }
    : row.scopeKind === 'workspace' ? { kind: 'workspace', workspaceId: row.workspaceId! } : { kind: 'private' }
export type FindingSynthesisResult = { groups: Array<{ payload: unknown; sourceIds: string[]; explanation: string }>; omissions: Array<{ sourceId: string; reason: string }>; usage?: { inputTokens?: number; outputTokens?: number } }

export class FindingsReviewStore {
  constructor(private readonly db: PluginDatabase, private readonly now: () => number = Date.now, private readonly uuid: () => string = randomUUID) {}

  importLegacy(args: {
    legacyId: string
    scope: FindingScope
    observationId: string
    targetKind: string
    targetVersion: number
    validation: FindingReviewValidation
    status: 'pending' | 'accepted' | 'rejected'
    createdAt: number
  }): { candidateId: string; revision: number; payloadHash: string } {
    const candidateId = `legacy-${hash(args.legacyId).slice(0, 32)}`
    const bundleId = `legacy-bundle-${hash(args.legacyId).slice(0, 32)}`
    const existing = this.candidate(candidateId)
    const status = args.status === 'pending' ? 'ready' : args.status === 'accepted' ? 'applied' : 'dismissed'
    const scope = args.scope
    if (existing) {
      const exact = existing.revision === 1
        && existing.payloadHash === args.validation.payloadHash
        && reviewScopeKey(existing.scope) === reviewScopeKey(scope)
        && JSON.stringify(existing.warnings) === JSON.stringify(args.validation.warnings)
        && existing.sourceObservationIds.length === 1
        && existing.sourceObservationIds[0] === args.observationId
      if (!exact) throw new FindingCaptureError('conflict', 'legacy proposal changed after its findings import')
      if (existing.status !== status) {
        if (existing.status !== 'ready' || status === 'ready') throw new FindingCaptureError('conflict', 'legacy proposal lifecycle changed incompatibly after import')
        this.db.transaction((tx) => {
          tx.update(findingCandidates).set({ status, updatedAt: this.now() }).where(eq(findingCandidates.id, candidateId)).run()
          this.action(tx, candidateId, 1, 'legacy-import', status === 'applied' ? 'applied' : 'dismiss', status === 'applied' ? 'Legacy proposal was accepted while Findings was disabled.' : 'Legacy proposal was rejected while Findings was disabled.', `legacy:${args.legacyId}:${status}`, this.now())
        })
      }
      return { candidateId, revision: existing.revision, payloadHash: existing.payloadHash }
    }
    this.db.transaction((tx) => {
      tx.insert(findingCandidates).values({
        id: candidateId,
        targetKind: args.targetKind,
        targetVersion: args.targetVersion,
        scopeKind: scope.kind,
        taskId: scope.kind === 'task' ? scope.taskId : null,
        projectId: scope.kind === 'project' ? scope.projectId : null,
        workspaceId: scope.kind === 'workspace' ? scope.workspaceId : null,
        currentRevision: 1,
        status,
        fingerprint: args.validation.fingerprint,
        subjectKey: args.validation.subjectKey,
        groupingExplanation: 'Imported unchanged from the legacy memory proposal queue.',
        warningsJson: JSON.stringify(args.validation.warnings),
        baseTargetId: args.validation.base?.targetId ?? null,
        baseHash: args.validation.base?.hash ?? null,
        basePayloadJson: args.validation.base ? JSON.stringify(args.validation.base.payload) : null,
        snoozedUntil: null,
        createdAt: args.createdAt,
        updatedAt: args.createdAt,
      }).run()
      tx.insert(findingCandidateRevisions).values({ candidateId, revision: 1, payloadJson: JSON.stringify(args.validation.payload), payloadHash: args.validation.payloadHash, createdAt: args.createdAt }).run()
      tx.insert(findingCandidateObservations).values({ candidateId, observationId: args.observationId, ordinal: 0 }).run()
      tx.insert(findingBundles).values({
        id: bundleId,
        scopeKind: scope.kind,
        taskId: scope.kind === 'task' ? scope.taskId : null,
        projectId: scope.kind === 'project' ? scope.projectId : null,
        workspaceId: scope.kind === 'workspace' ? scope.workspaceId : null,
        boundaryKey: `legacy:${args.legacyId}`,
        revision: 1,
        state: 'ready',
        inputCount: 1,
        pendingCount: 0,
        error: null,
        createdAt: args.createdAt,
        updatedAt: args.createdAt,
      }).run()
      tx.insert(findingBundleCandidates).values({ bundleId, candidateId, ordinal: 0 }).run()
      tx.insert(findingGroupingOutcomes).values({ bundleId, observationId: args.observationId, outcome: 'candidate', candidateId, explanation: 'Imported unchanged from the legacy queue.' }).run()
      if (status === 'applied' || status === 'dismissed') {
        this.action(tx, candidateId, 1, 'legacy-import', status === 'applied' ? 'applied' : 'dismiss', status === 'applied' ? 'Legacy proposal was already accepted.' : 'Legacy rejection.', `legacy:${args.legacyId}:${status}`, args.createdAt)
      }
    })
    return { candidateId, revision: 1, payloadHash: args.validation.payloadHash }
  }

  candidate(candidateId: string, revision?: number): FindingCandidateRevision | null {
    const row = this.db.select().from(findingCandidates).where(eq(findingCandidates.id, candidateId)).get()
    if (!row) return null
    const rev = revision ?? row.currentRevision
    const content = this.db.select().from(findingCandidateRevisions).where(and(eq(findingCandidateRevisions.candidateId, candidateId), eq(findingCandidateRevisions.revision, rev))).get()
    if (!content) return null
    const sources = this.db.select().from(findingCandidateObservations).where(eq(findingCandidateObservations.candidateId, candidateId)).orderBy(asc(findingCandidateObservations.ordinal)).all()
    return {
      candidateId, revision: rev, targetKind: row.targetKind, targetVersion: row.targetVersion,
      scope: storedScope(row), payload: JSON.parse(content.payloadJson), sourceObservationIds: sources.map((source) => source.observationId),
      payloadHash: content.payloadHash, fingerprint: row.fingerprint, subjectKey: row.subjectKey,
      groupingExplanation: row.groupingExplanation, warnings: JSON.parse(row.warningsJson) as string[],
      base: row.baseTargetId && row.baseHash && row.basePayloadJson ? { targetId: row.baseTargetId, hash: row.baseHash, payload: JSON.parse(row.basePayloadJson) } : null,
      status: row.status === 'snoozed' && row.snoozedUntil !== null && row.snoozedUntil <= this.now() ? 'ready' : row.status as FindingCandidateRevision['status'],
      snoozedUntil: row.snoozedUntil, createdAt: row.createdAt, updatedAt: row.updatedAt,
    }
  }

  private outcomeRows(bundleId: string): FindingGroupingOutcome[] {
    return this.db.select().from(findingGroupingOutcomes).where(eq(findingGroupingOutcomes.bundleId, bundleId)).all()
      .map((row) => ({ observationId: row.observationId, outcome: row.outcome as FindingGroupingOutcome['outcome'], candidateId: row.candidateId, explanation: row.explanation }))
  }

  bundles(scope: FindingScope, includeHistory = false): FindingBundle[] {
    const candidateFilter = includeHistory ? undefined : or(eq(findingCandidates.status, 'ready'), and(eq(findingCandidates.status, 'snoozed'), lte(findingCandidates.snoozedUntil, this.now())))
    const rows = this.db.select().from(findingBundles).where(and(
      eq(findingBundles.scopeKind, scope.kind),
      scope.kind === 'task' ? eq(findingBundles.taskId, scope.taskId) : isNull(findingBundles.taskId),
      scope.kind === 'project' ? eq(findingBundles.projectId, scope.projectId) : isNull(findingBundles.projectId),
      scope.kind === 'workspace' ? eq(findingBundles.workspaceId, scope.workspaceId) : isNull(findingBundles.workspaceId),
    )).orderBy(desc(findingBundles.updatedAt)).all()
    return rows.map((row) => {
      const job = this.db.select({ backendId: findingPreparationJobs.backendId, modelId: findingPreparationJobs.modelId }).from(findingPreparationJobs).where(eq(findingPreparationJobs.bundleId, row.id)).get()
      const members = this.db.select({ id: findingBundleCandidates.candidateId }).from(findingBundleCandidates)
        .innerJoin(findingCandidates, eq(findingCandidates.id, findingBundleCandidates.candidateId))
        .where(and(eq(findingBundleCandidates.bundleId, row.id), candidateFilter)).orderBy(asc(findingBundleCandidates.ordinal)).all()
      return { id: row.id, scope, boundaryKey: row.boundaryKey, revision: row.revision, state: row.state as FindingBundle['state'], backendId: job?.backendId ?? null, modelId: job?.modelId ?? null,
        candidates: members.flatMap(({ id }) => this.candidate(id) ? [this.candidate(id)!] : []), outcomes: this.outcomeRows(row.id),
        inputCount: row.inputCount, pendingCount: row.pendingCount, createdAt: row.createdAt, updatedAt: row.updatedAt, error: row.error }
    })
  }

  async prepare(args: { scope: FindingScope; sourceTaskId?: string; boundaryKey: string; backendId?: string; modelId?: string; targetKind: string; target: FindingReviewTargetContribution; synthesize?: (observations: FindingObservation[]) => Promise<FindingSynthesisResult>; observations: FindingObservation[] }): Promise<FindingBundle> {
    const at = this.now(), scopeKey = reviewScopeKey(args.scope)
    const existingJob = this.db.select().from(findingPreparationJobs).where(and(eq(findingPreparationJobs.scopeKey, scopeKey), eq(findingPreparationJobs.boundaryKey, args.boundaryKey))).get()
    if (existingJob?.bundleId && existingJob.state === 'complete') return this.requireBundle(args.scope, existingJob.bundleId)
    const running = this.db.select().from(findingPreparationJobs).where(and(eq(findingPreparationJobs.scopeKey, scopeKey), eq(findingPreparationJobs.state, 'running'))).get()
    if (running?.leaseExpiresAt && running.leaseExpiresAt > at) {
      if (running.boundaryKey === args.boundaryKey && running.bundleId) return this.requireBundle(args.scope, running.bundleId)
      throw new FindingCaptureError('conflict', 'another preparation is already running for this scope')
    }
    if (running) this.db.update(findingPreparationJobs).set({ state: 'failed', leaseOwner: null, leaseExpiresAt: null, error: 'preparation lease expired', updatedAt: at }).where(eq(findingPreparationJobs.id, running.id)).run()

    const jobId = existingJob?.id ?? this.uuid(), bundleId = existingJob?.bundleId ?? this.uuid()
    const sourceObservation = args.observations.find((observation) => observation.scope.kind === 'task')
    const inferredTaskId = sourceObservation?.scope.kind === 'task' ? sourceObservation.scope.taskId : undefined
    const sourceTaskId = existingJob?.sourceTaskId ?? args.sourceTaskId ?? inferredTaskId
    if (!sourceTaskId) throw new FindingCaptureError('invalid-input', 'preparation source task is required')
    const backendId = existingJob ? existingJob.backendId : args.backendId ?? null
    const modelId = existingJob ? existingJob.modelId : args.modelId ?? null
    const inputRows = existingJob ? this.db.select().from(findingPreparationInputs).where(eq(findingPreparationInputs.jobId, jobId)).orderBy(asc(findingPreparationInputs.ordinal)).all() : []
    const observationById = new Map(args.observations.map((observation) => [observation.id, observation]))
    const frozen = inputRows.length ? inputRows.map((row) => observationById.get(row.observationId)).filter((observation): observation is FindingObservation => !!observation) : args.observations
    if (inputRows.length && frozen.length !== inputRows.length) throw new FindingCaptureError('unavailable', 'one or more frozen preparation inputs are unavailable')
    const processed = new Set(this.outcomeRows(bundleId).map((outcome) => outcome.observationId))
    const remaining = frozen.filter((observation) => !processed.has(observation.id))
    const priorOutputCount = existingJob?.outputCount ?? 0
    this.db.transaction((tx) => {
      tx.insert(findingPreparationJobs).values({ id: jobId, boundaryKey: args.boundaryKey, scopeKey, inputHighWaterMark: Math.max(0, ...frozen.map((observation) => observation.createdAt)), state: 'running', leaseOwner: `${process.pid}`, leaseExpiresAt: at + 60_000, attempt: (existingJob?.attempt ?? 0) + 1, sourceTaskId, backendId, modelId, usageJson: existingJob?.usageJson ?? null, inputCount: frozen.length, outputCount: priorOutputCount, error: null, bundleId, createdAt: existingJob?.createdAt ?? at, updatedAt: at }).onConflictDoUpdate({ target: findingPreparationJobs.id, set: { state: 'running', leaseOwner: `${process.pid}`, leaseExpiresAt: at + 60_000, attempt: (existingJob?.attempt ?? 0) + 1, sourceTaskId, backendId, modelId, error: null, updatedAt: at } }).run()
      tx.insert(findingBundles).values({ id: bundleId, scopeKind: args.scope.kind, taskId: args.scope.kind === 'task' ? args.scope.taskId : null, projectId: args.scope.kind === 'project' ? args.scope.projectId : null, workspaceId: args.scope.kind === 'workspace' ? args.scope.workspaceId : null, boundaryKey: args.boundaryKey, revision: 1, state: 'preparing', inputCount: frozen.length, pendingCount: remaining.length, error: null, createdAt: at, updatedAt: at }).onConflictDoUpdate({ target: findingBundles.id, set: { state: 'preparing', pendingCount: remaining.length, error: null, updatedAt: at } }).run()
      if (!inputRows.length) frozen.forEach((observation, ordinal) => tx.insert(findingPreparationInputs).values({ jobId, observationId: observation.id, ordinal }).run())
    })

    const accepted = new Set(await args.target.acceptedFingerprints(args.scope))
    const outstanding = new Map(this.db.select().from(findingCandidates).where(scopeWhere(args.scope)).all().map((row) => [row.fingerprint, row]))
    const suppressionRows = this.db.select().from(findingSuppressions).where(and(eq(findingSuppressions.scopeKey, scopeKey), isNull(findingSuppressions.removedAt), or(isNull(findingSuppressions.expiresAt), gt(findingSuppressions.expiresAt, at)))).all()
    const chunks = args.synthesize ? this.preparationChunks(remaining) : [remaining]
    for (const chunk of chunks) {
      if (!chunk.length) continue
      if (this.preparationCancelled(jobId)) return this.requireBundle(args.scope, bundleId)
      const synthesis = args.synthesize ? await args.synthesize(chunk) : { groups: chunk.map((observation) => ({ payload: this.deterministicPayload(observation, args.scope), sourceIds: [observation.id], explanation: 'One distinct observation retained for explicit review.' })), omissions: [] }
      if (this.preparationCancelled(jobId)) return this.requireBundle(args.scope, bundleId)
      const added = await this.publishPreparationChunk({ ...args, jobId, bundleId, chunk, synthesis, accepted, outstanding, suppressionRows })
      const completedCount = this.outcomeRows(bundleId).length
      const currentBundle = this.requireBundle(args.scope, bundleId)
      const job = this.db.select().from(findingPreparationJobs).where(eq(findingPreparationJobs.id, jobId)).get()!
      const priorUsage = job.usageJson ? JSON.parse(job.usageJson) as { inputTokens?: number; outputTokens?: number } : {}
      const usage = synthesis.usage ? { inputTokens: (priorUsage.inputTokens ?? 0) + (synthesis.usage.inputTokens ?? 0), outputTokens: (priorUsage.outputTokens ?? 0) + (synthesis.usage.outputTokens ?? 0) } : priorUsage
      this.db.transaction((tx) => {
        tx.update(findingBundles).set({ revision: currentBundle.revision + 1, pendingCount: Math.max(0, frozen.length - completedCount), updatedAt: this.now() }).where(eq(findingBundles.id, bundleId)).run()
        tx.update(findingPreparationJobs).set({ leaseExpiresAt: this.now() + 60_000, usageJson: Object.keys(usage).length ? JSON.stringify(usage) : null, outputCount: sql`${findingPreparationJobs.outputCount} + ${added}`, updatedAt: this.now() }).where(eq(findingPreparationJobs.id, jobId)).run()
      })
    }
    if (this.preparationCancelled(jobId)) return this.requireBundle(args.scope, bundleId)
    const currentBundle = this.requireBundle(args.scope, bundleId)
    this.db.transaction((tx) => {
      const members = tx.select().from(findingBundleCandidates).where(eq(findingBundleCandidates.bundleId, bundleId)).orderBy(asc(findingBundleCandidates.ordinal)).all()
      const ranked = members.map((member, index) => ({ member, index, candidate: this.candidate(member.candidateId) })).sort((left, right) => {
        const leftRank = (left.candidate?.payload as { operation?: unknown })?.operation === 'update' ? 0 : 1
        const rightRank = (right.candidate?.payload as { operation?: unknown })?.operation === 'update' ? 0 : 1
        return leftRank - rightRank || left.index - right.index
      })
      ranked.forEach(({ member }, ordinal) => tx.update(findingBundleCandidates).set({ ordinal }).where(and(eq(findingBundleCandidates.bundleId, bundleId), eq(findingBundleCandidates.candidateId, member.candidateId))).run())
      tx.update(findingBundles).set({ revision: currentBundle.revision + 1, state: 'ready', pendingCount: 0, error: null, updatedAt: this.now() }).where(eq(findingBundles.id, bundleId)).run()
      tx.update(findingPreparationJobs).set({ state: 'complete', leaseOwner: null, leaseExpiresAt: null, error: null, updatedAt: this.now() }).where(eq(findingPreparationJobs.id, jobId)).run()
    })
    return this.requireBundle(args.scope, bundleId)
  }

  preparationSource(bundleId: string): { taskId: string; boundaryKey: string; backendId: string | null; modelId: string | null } {
    const job = this.db.select().from(findingPreparationJobs).where(eq(findingPreparationJobs.bundleId, bundleId)).get()
    if (!job) throw new FindingCaptureError('not-found', 'preparation job not found')
    if (!job.sourceTaskId) throw new FindingCaptureError('unavailable', 'preparation source task is unavailable')
    return { taskId: job.sourceTaskId, boundaryKey: job.boundaryKey, backendId: job.backendId, modelId: job.modelId }
  }

  preparationSourceForBoundary(scope: FindingScope, boundaryKey: string): { taskId: string; boundaryKey: string; backendId: string | null; modelId: string | null } | null {
    const job = this.db.select().from(findingPreparationJobs).where(and(eq(findingPreparationJobs.scopeKey, reviewScopeKey(scope)), eq(findingPreparationJobs.boundaryKey, boundaryKey))).get()
    if (!job) return null
    if (!job.sourceTaskId) throw new FindingCaptureError('unavailable', 'preparation source task is unavailable')
    return { taskId: job.sourceTaskId, boundaryKey: job.boundaryKey, backendId: job.backendId, modelId: job.modelId }
  }

  preparationInputIdsForBoundary(scope: FindingScope, boundaryKey: string): string[] | null {
    const job = this.db.select({ id: findingPreparationJobs.id }).from(findingPreparationJobs)
      .where(and(eq(findingPreparationJobs.scopeKey, reviewScopeKey(scope)), eq(findingPreparationJobs.boundaryKey, boundaryKey))).get()
    if (!job) return null
    return this.db.select({ observationId: findingPreparationInputs.observationId }).from(findingPreparationInputs)
      .where(eq(findingPreparationInputs.jobId, job.id)).orderBy(asc(findingPreparationInputs.ordinal)).all()
      .map((row) => row.observationId)
  }

  private preparationChunks(observations: FindingObservation[]): FindingObservation[][] {
    const chunks: FindingObservation[][] = []
    for (const observation of observations) {
      const current = chunks.at(-1)
      const nextBytes = new TextEncoder().encode(JSON.stringify([...(current ?? []), observation])).byteLength
      if (!current || current.length >= 50 || nextBytes > 32 * 1024) chunks.push([observation])
      else current.push(observation)
    }
    return chunks
  }

  private deterministicPayload(observation: FindingObservation, scope: FindingScope): unknown {
    return { operation: 'add', name: observation.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80) || `finding-${observation.id.slice(0, 8)}`, type: 'reference', description: observation.title, body: observation.body, scope: scope.kind === 'project' ? { kind: 'project', projectId: scope.projectId } : scope.kind === 'task' ? { kind: 'project' } : { kind: 'private' } }
  }

  private preparationCancelled(jobId: string): boolean {
    return this.db.select({ state: findingPreparationJobs.state }).from(findingPreparationJobs).where(eq(findingPreparationJobs.id, jobId)).get()?.state === 'cancelled'
  }

  private requireBundle(scope: FindingScope, bundleId: string): FindingBundle {
    const bundle = this.bundles(scope, true).find((entry) => entry.id === bundleId)
    if (!bundle) throw new FindingCaptureError('not-found', 'preparation bundle not found')
    return bundle
  }

  private async publishPreparationChunk(args: {
    scope: FindingScope; targetKind: string; target: FindingReviewTargetContribution; jobId: string; bundleId: string
    chunk: FindingObservation[]; synthesis: FindingSynthesisResult
    accepted: Set<string>; outstanding: Map<string, typeof findingCandidates.$inferSelect>; suppressionRows: Array<typeof findingSuppressions.$inferSelect>
  }): Promise<number> {
    const knownIds = new Set(args.chunk.map((observation) => observation.id)), accounted = new Map<string, number>()
    for (const group of args.synthesis.groups) for (const sourceId of group.sourceIds) accounted.set(sourceId, (accounted.get(sourceId) ?? 0) + 1)
    for (const omission of args.synthesis.omissions) accounted.set(omission.sourceId, (accounted.get(omission.sourceId) ?? 0) + 1)
    if (accounted.size !== knownIds.size || [...knownIds].some((id) => accounted.get(id) !== 1) || [...accounted].some(([id]) => !knownIds.has(id))) throw new FindingCaptureError('invalid-input', 'synthesis must account for every source ID exactly once as included or omitted')
    const suppressions = new Set(args.suppressionRows.map((row) => row.fingerprint))
    const omissionReasons = new Map(args.synthesis.omissions.map((omission) => [omission.sourceId, omission.reason]))
    const outcomes: FindingGroupingOutcome[] = args.synthesis.omissions.map((omission) => ({ observationId: omission.sourceId, outcome: 'not-selected', candidateId: null, explanation: omissionReasons.get(omission.sourceId)! }))
    const prepared: Array<{ id: string; validation: FindingReviewValidation; sourceIds: string[]; explanation: string }> = []
    const preparedByFingerprint = new Map<string, (typeof prepared)[number]>()
    for (const group of args.synthesis.groups) {
      if (!group.sourceIds.length) throw new FindingCaptureError('invalid-input', 'synthesis returned an empty source-ID group')
      let validation = await args.target.validate({ scope: args.scope, payload: group.payload })
      if (!suppressions.has(validation.fingerprint) && args.suppressionRows.some((row) => row.subjectKey === validation.subjectKey)) validation = { ...validation, warnings: [...validation.warnings, 'Updated since dismissal.'] }
      const inChunk = preparedByFingerprint.get(validation.fingerprint)
      if (inChunk) {
        inChunk.sourceIds.push(...group.sourceIds)
        group.sourceIds.forEach((observationId) => outcomes.push({ observationId, outcome: 'candidate', candidateId: inChunk.id, explanation: 'Exact duplicate evidence grouped into the same proposed change.' }))
        continue
      }
      const classification = args.accepted.has(validation.fingerprint) ? 'already-covered' : suppressions.has(validation.fingerprint) ? 'suppressed' : args.outstanding.has(validation.fingerprint) ? 'duplicate' : 'candidate'
      const linked = args.outstanding.get(validation.fingerprint)?.id ?? null
      if (classification === 'candidate') {
        const entry = { id: this.uuid(), validation, sourceIds: [...group.sourceIds], explanation: group.explanation }
        prepared.push(entry); preparedByFingerprint.set(validation.fingerprint, entry)
        args.outstanding.set(validation.fingerprint, { id: entry.id } as typeof findingCandidates.$inferSelect)
        group.sourceIds.forEach((observationId) => outcomes.push({ observationId, outcome: 'candidate', candidateId: entry.id, explanation: group.explanation }))
      } else group.sourceIds.forEach((observationId) => outcomes.push({ observationId, outcome: classification, candidateId: linked, explanation: classification.replace('-', ' ') }))
    }
    prepared.sort((left, right) => Number((left.validation.payload as { operation?: unknown })?.operation !== 'update') - Number((right.validation.payload as { operation?: unknown })?.operation !== 'update'))
    const at = this.now(), existingMembers = this.db.select().from(findingBundleCandidates).where(eq(findingBundleCandidates.bundleId, args.bundleId)).all()
    let ordinal = existingMembers.length
    this.db.transaction((tx) => {
      for (const entry of prepared) {
        const validation = entry.validation
        tx.insert(findingCandidates).values({ id: entry.id, targetKind: args.targetKind, targetVersion: args.target.version, scopeKind: args.scope.kind, taskId: args.scope.kind === 'task' ? args.scope.taskId : null, projectId: args.scope.kind === 'project' ? args.scope.projectId : null, workspaceId: args.scope.kind === 'workspace' ? args.scope.workspaceId : null, currentRevision: 1, status: 'ready', fingerprint: validation.fingerprint, subjectKey: validation.subjectKey, groupingExplanation: entry.explanation, warningsJson: JSON.stringify(validation.warnings), baseTargetId: validation.base?.targetId ?? null, baseHash: validation.base?.hash ?? null, basePayloadJson: validation.base ? JSON.stringify(validation.base.payload) : null, snoozedUntil: null, createdAt: at, updatedAt: at }).run()
        tx.insert(findingCandidateRevisions).values({ candidateId: entry.id, revision: 1, payloadJson: JSON.stringify(validation.payload), payloadHash: validation.payloadHash, createdAt: at }).run()
        entry.sourceIds.forEach((observationId, sourceOrdinal) => tx.insert(findingCandidateObservations).values({ candidateId: entry.id, observationId, ordinal: sourceOrdinal }).run())
        tx.insert(findingBundleCandidates).values({ bundleId: args.bundleId, candidateId: entry.id, ordinal: ordinal++ }).run()
      }
      for (const outcome of outcomes) {
        tx.insert(findingGroupingOutcomes).values({ bundleId: args.bundleId, ...outcome }).onConflictDoUpdate({ target: [findingGroupingOutcomes.bundleId, findingGroupingOutcomes.observationId], set: { outcome: outcome.outcome, candidateId: outcome.candidateId, explanation: outcome.explanation } }).run()
        if (outcome.outcome === 'duplicate' && outcome.candidateId) {
          const sourceOrdinal = tx.select().from(findingCandidateObservations).where(eq(findingCandidateObservations.candidateId, outcome.candidateId)).all().length
          tx.insert(findingCandidateObservations).values({ candidateId: outcome.candidateId, observationId: outcome.observationId, ordinal: sourceOrdinal }).onConflictDoNothing().run()
        }
      }
    })
    return prepared.length
  }

  failPreparation(scope: FindingScope, boundaryKey: string, message: string): FindingBundle {
    const at = this.now(), key = reviewScopeKey(scope)
    const job = this.db.select().from(findingPreparationJobs).where(and(eq(findingPreparationJobs.scopeKey, key), eq(findingPreparationJobs.boundaryKey, boundaryKey))).get()
    if (!job) throw new FindingCaptureError('not-found', 'preparation job not found')
    const bundleId = job.bundleId ?? this.uuid()
    const previous = job.bundleId ? this.bundles(scope, true).find((bundle) => bundle.id === job.bundleId) : null
    this.db.transaction((tx) => {
      tx.insert(findingBundles).values({ id: bundleId, scopeKind: scope.kind, taskId: scope.kind === 'task' ? scope.taskId : null, projectId: scope.kind === 'project' ? scope.projectId : null, workspaceId: scope.kind === 'workspace' ? scope.workspaceId : null, boundaryKey, revision: 1, state: 'failed', inputCount: job.inputCount, pendingCount: previous?.pendingCount ?? job.inputCount, error: message, createdAt: at, updatedAt: at }).onConflictDoUpdate({ target: findingBundles.id, set: { revision: (previous?.revision ?? 0) + 1, state: 'failed', pendingCount: previous?.pendingCount ?? job.inputCount, error: message, updatedAt: at } }).run()
      tx.update(findingPreparationJobs).set({ state: 'failed', leaseOwner: null, leaseExpiresAt: null, error: message, bundleId, updatedAt: at }).where(eq(findingPreparationJobs.id, job.id)).run()
    })
    return this.bundles(scope, true).find((bundle) => bundle.id === bundleId)!
  }

  cancelPreparation(bundleId: string): FindingBundle {
    const bundle = this.db.select().from(findingBundles).where(eq(findingBundles.id, bundleId)).get()
    if (!bundle) throw new FindingCaptureError('not-found', 'preparation bundle not found')
    const scope = storedScope(bundle)
    if (bundle.state !== 'preparing') return this.bundles(scope, true).find((entry) => entry.id === bundleId)!
    const at = this.now()
    this.db.transaction((tx) => {
      tx.update(findingBundles).set({ revision: bundle.revision + 1, state: 'cancelled', updatedAt: at }).where(eq(findingBundles.id, bundleId)).run()
      tx.update(findingPreparationJobs).set({ state: 'cancelled', leaseOwner: null, leaseExpiresAt: null, updatedAt: at }).where(eq(findingPreparationJobs.bundleId, bundleId)).run()
    })
    return this.bundles(scope, true).find((entry) => entry.id === bundleId)!
  }

  restoreObservation(args: { bundleId: string; observationId: string; candidateId: string; expectedRevision: number; actorId: string; idempotencyKey: string }): FindingBundle {
    const reason = `${args.bundleId}:${args.observationId}`
    const repeated = this.db.select().from(findingReviewActions).where(eq(findingReviewActions.idempotencyKey, args.idempotencyKey)).get()
    if (repeated) {
      if (repeated.candidateId === args.candidateId && repeated.expectedRevision === args.expectedRevision && repeated.action === 'restore' && repeated.reason === reason) return this.bundleForCandidate(args.bundleId, args.candidateId)
      throw new FindingCaptureError('conflict', 'idempotency key belongs to a different review action')
    }
    const current = this.requireCurrent(args.candidateId, args.expectedRevision)
    if (current.status !== 'ready') throw new FindingCaptureError('conflict', 'only a ready candidate can receive restored evidence')
    const bundle = this.bundleForCandidate(args.bundleId, args.candidateId)
    const outcome = this.db.select().from(findingGroupingOutcomes).where(and(eq(findingGroupingOutcomes.bundleId, args.bundleId), eq(findingGroupingOutcomes.observationId, args.observationId))).get()
    if (!outcome || outcome.outcome !== 'not-selected') throw new FindingCaptureError('conflict', 'only an omitted observation can be restored')
    const at = this.now()
    const ordinal = this.db.select().from(findingCandidateObservations).where(eq(findingCandidateObservations.candidateId, args.candidateId)).all().length
    this.db.transaction((tx) => {
      tx.insert(findingCandidateObservations).values({ candidateId: args.candidateId, observationId: args.observationId, ordinal }).run()
      tx.update(findingGroupingOutcomes).set({ outcome: 'candidate', candidateId: args.candidateId, explanation: 'Restored to this candidate by the reviewer.' }).where(and(eq(findingGroupingOutcomes.bundleId, args.bundleId), eq(findingGroupingOutcomes.observationId, args.observationId))).run()
      tx.update(findingCandidates).set({ updatedAt: at }).where(eq(findingCandidates.id, args.candidateId)).run()
      tx.update(findingBundles).set({ revision: bundle.revision + 1, updatedAt: at }).where(eq(findingBundles.id, args.bundleId)).run()
      this.action(tx, args.candidateId, current.revision, args.actorId, 'restore', reason, args.idempotencyKey, at)
    })
    return this.requireBundle(bundle.scope, args.bundleId)
  }

  splitCandidate(args: { bundleId: string; candidateId: string; expectedRevision: number; observationIds: string[]; actorId: string; idempotencyKey: string }): FindingBundle {
    const selected = [...new Set(args.observationIds)].sort()
    const repeated = this.db.select().from(findingReviewActions).where(eq(findingReviewActions.idempotencyKey, args.idempotencyKey)).get()
    if (repeated) {
      if (repeated.candidateId === args.candidateId && repeated.expectedRevision === args.expectedRevision && repeated.action === 'split' && repeated.reason?.endsWith(`:${JSON.stringify(selected)}`)) return this.bundleForCandidate(args.bundleId, args.candidateId)
      throw new FindingCaptureError('conflict', 'idempotency key belongs to a different review action')
    }
    const current = this.requireCurrent(args.candidateId, args.expectedRevision)
    if (current.status !== 'ready') throw new FindingCaptureError('conflict', 'only a ready candidate can be split')
    const bundle = this.bundleForCandidate(args.bundleId, args.candidateId)
    const sourceRows = this.db.select().from(findingCandidateObservations).where(eq(findingCandidateObservations.candidateId, args.candidateId)).orderBy(asc(findingCandidateObservations.ordinal)).all()
    const sourceIds = new Set(sourceRows.map((row) => row.observationId))
    if (!selected.length || selected.length >= sourceRows.length || selected.some((id) => !sourceIds.has(id))) throw new FindingCaptureError('invalid-input', 'split observations must be a non-empty proper subset of the candidate sources')
    const candidateRow = this.db.select().from(findingCandidates).where(eq(findingCandidates.id, args.candidateId)).get()!
    const revisionRow = this.db.select().from(findingCandidateRevisions).where(and(eq(findingCandidateRevisions.candidateId, args.candidateId), eq(findingCandidateRevisions.revision, current.revision))).get()!
    const membership = this.db.select().from(findingBundleCandidates).where(and(eq(findingBundleCandidates.bundleId, args.bundleId), eq(findingBundleCandidates.candidateId, args.candidateId))).get()!
    const newCandidateId = this.uuid(), at = this.now(), actionReason = `${newCandidateId}:${JSON.stringify(selected)}`
    this.db.transaction((tx) => {
      tx.update(findingBundleCandidates).set({ ordinal: sql`${findingBundleCandidates.ordinal} + 1` }).where(and(eq(findingBundleCandidates.bundleId, args.bundleId), gt(findingBundleCandidates.ordinal, membership.ordinal))).run()
      tx.insert(findingCandidates).values({ ...candidateRow, id: newCandidateId, currentRevision: 1, status: 'ready', groupingExplanation: 'Separated from a grouped candidate by the reviewer.', createdAt: at, updatedAt: at }).run()
      tx.insert(findingCandidateRevisions).values({ candidateId: newCandidateId, revision: 1, payloadJson: revisionRow.payloadJson, payloadHash: revisionRow.payloadHash, createdAt: at }).run()
      tx.delete(findingCandidateObservations).where(and(eq(findingCandidateObservations.candidateId, args.candidateId), inArray(findingCandidateObservations.observationId, selected))).run()
      selected.forEach((observationId, ordinal) => tx.insert(findingCandidateObservations).values({ candidateId: newCandidateId, observationId, ordinal }).run())
      tx.insert(findingBundleCandidates).values({ bundleId: args.bundleId, candidateId: newCandidateId, ordinal: membership.ordinal + 1 }).run()
      tx.update(findingGroupingOutcomes).set({ candidateId: newCandidateId, explanation: 'Separated into its own candidate by the reviewer.' }).where(and(eq(findingGroupingOutcomes.bundleId, args.bundleId), inArray(findingGroupingOutcomes.observationId, selected))).run()
      tx.update(findingBundles).set({ revision: bundle.revision + 1, updatedAt: at }).where(eq(findingBundles.id, args.bundleId)).run()
      this.action(tx, args.candidateId, current.revision, args.actorId, 'split', actionReason, args.idempotencyKey, at)
    })
    return this.requireBundle(bundle.scope, args.bundleId)
  }

  edit(candidateId: string, expectedRevision: number, payload: unknown, validation: FindingReviewValidation, actorId: string, idempotencyKey: string): FindingCandidateRevision {
    const repeated = this.db.select().from(findingReviewActions).where(eq(findingReviewActions.idempotencyKey, idempotencyKey)).get()
    if (repeated) {
      if (repeated.candidateId === candidateId && repeated.expectedRevision === expectedRevision && repeated.action === 'edit' && repeated.reason === validation.payloadHash) return this.candidate(candidateId)!
      throw new FindingCaptureError('conflict', 'idempotency key belongs to a different review action')
    }
    const current = this.requireCurrent(candidateId, expectedRevision)
    if (current.status !== 'ready' && current.status !== 'conflict') throw new FindingCaptureError('conflict', 'only a ready or conflicted candidate can be edited')
    const at = this.now(), revision = current.revision + 1
    this.db.transaction((tx) => {
      tx.insert(findingCandidateRevisions).values({ candidateId, revision, payloadJson: JSON.stringify(payload), payloadHash: validation.payloadHash, createdAt: at }).run()
      tx.update(findingCandidates).set({ currentRevision: revision, status: 'ready', fingerprint: validation.fingerprint, subjectKey: validation.subjectKey, warningsJson: JSON.stringify(validation.warnings), baseTargetId: validation.base?.targetId ?? null, baseHash: validation.base?.hash ?? null, basePayloadJson: validation.base ? JSON.stringify(validation.base.payload) : null, updatedAt: at }).where(eq(findingCandidates.id, candidateId)).run()
      this.action(tx, candidateId, expectedRevision, actorId, 'edit', validation.payloadHash, idempotencyKey, at)
    }); return this.candidate(candidateId)!
  }

  decide(args: { candidateId: string; expectedRevision: number; actorId: string; action: 'dismiss' | 'dismiss-reason' | 'undo-dismiss' | 'snooze'; reason?: string; until?: number; idempotencyKey: string }): FindingCandidateRevision {
    const repeated = this.db.select().from(findingReviewActions).where(eq(findingReviewActions.idempotencyKey, args.idempotencyKey)).get()
    const actionReason = args.action === 'snooze' ? String(args.until) : args.reason ?? null
    if (repeated) {
      if (repeated.candidateId === args.candidateId && repeated.expectedRevision === args.expectedRevision && repeated.action === args.action && repeated.reason === actionReason) return this.candidate(args.candidateId)!
      throw new FindingCaptureError('conflict', 'idempotency key belongs to a different review action')
    }
    const current = this.requireCurrent(args.candidateId, args.expectedRevision)
    if (args.action === 'dismiss-reason' && !args.reason?.trim()) throw new FindingCaptureError('invalid-input', 'a dismissal reason cannot be blank')
    const updatesDismissal = args.action === 'undo-dismiss' || args.action === 'dismiss-reason'
    if (updatesDismissal ? current.status !== 'dismissed' : current.status !== 'ready') {
      throw new FindingCaptureError('conflict', updatesDismissal ? 'only a dismissed candidate can be updated' : 'only a ready candidate can be dismissed or snoozed')
    }
    const at = this.now()
    const status = args.action === 'dismiss' || args.action === 'dismiss-reason' ? 'dismissed' : args.action === 'snooze' ? 'snoozed' : 'ready'
    this.db.transaction((tx) => {
      tx.update(findingCandidates).set({ status, snoozedUntil: args.action === 'snooze' ? args.until ?? null : null, updatedAt: at }).where(eq(findingCandidates.id, args.candidateId)).run()
      this.action(tx, args.candidateId, args.expectedRevision, args.actorId, args.action, actionReason, args.idempotencyKey, at)
      if (args.action === 'dismiss') tx.insert(findingSuppressions).values({ id: this.uuid(), scopeKey: reviewScopeKey(current.scope), fingerprint: current.fingerprint, subjectKey: current.subjectKey, reason: args.reason ?? null, actorId: args.actorId, expiresAt: null, createdAt: at, removedAt: null }).run()
      if (args.action === 'undo-dismiss') tx.update(findingSuppressions).set({ removedAt: at }).where(and(eq(findingSuppressions.scopeKey, reviewScopeKey(current.scope)), eq(findingSuppressions.fingerprint, current.fingerprint), isNull(findingSuppressions.removedAt))).run()
    }); return this.candidate(args.candidateId)!
  }

  transition(targetKind: string, candidateId: string, revision: number, operationId: string, status: 'applying' | 'applied' | 'conflict', targetReference?: string): FindingCandidateRevision {
    const actorId = `target:${targetKind}:${operationId}`
    const actionKey = `${actorId}:${status}`
    const repeated = this.db.select().from(findingReviewActions).where(eq(findingReviewActions.idempotencyKey, actionKey)).get()
    if (repeated) {
      if (repeated.candidateId === candidateId && repeated.expectedRevision === revision
        && repeated.actorId === actorId && repeated.action === status
        && repeated.reason === (targetReference ?? null)) return this.candidate(candidateId)!
      throw new FindingCaptureError('conflict', 'target operation belongs to a different candidate transition')
    }
    const current = this.requireCurrent(candidateId, revision)
    if (current.targetKind !== targetKind) throw new FindingCaptureError('forbidden', `review target '${targetKind}' does not own this candidate`)
    const allowed = status === 'applying'
      ? current.status === 'ready'
      : status === 'applied'
        ? current.status === 'applying'
        : current.status === 'ready' || current.status === 'applying'
    if (!allowed) throw new FindingCaptureError('conflict', `candidate cannot transition from '${current.status}' to '${status}'`)
    const at = this.now()
    this.db.transaction((tx) => {
      tx.update(findingCandidates).set({ status, updatedAt: at }).where(eq(findingCandidates.id, candidateId)).run()
      this.action(tx, candidateId, revision, actorId, status, targetReference ?? null, actionKey, at)
    })
    return this.candidate(candidateId)!
  }

  history(candidateId: string): FindingReviewHistory[] { return this.db.select().from(findingReviewActions).where(eq(findingReviewActions.candidateId, candidateId)).orderBy(desc(findingReviewActions.createdAt)).all().map((r) => ({ ...r, action: r.action as FindingReviewHistory['action'] })) }
  private bundleForCandidate(bundleId: string, candidateId: string): FindingBundle { const row = this.db.select().from(findingBundles).innerJoin(findingBundleCandidates, eq(findingBundleCandidates.bundleId, findingBundles.id)).where(and(eq(findingBundles.id, bundleId), eq(findingBundleCandidates.candidateId, candidateId))).get(); if (!row) throw new FindingCaptureError('not-found', 'candidate is not in this bundle'); return this.requireBundle(storedScope(row.finding_bundles), bundleId) }
  private requireCurrent(id: string, revision: number): FindingCandidateRevision { const current = this.candidate(id); if (!current) throw new FindingCaptureError('not-found', 'candidate not found'); if (current.revision !== revision) throw new FindingCaptureError('conflict', 'candidate revision changed; refresh before continuing'); return current }
  private action(tx: Pick<PluginDatabase, 'insert'>, candidateId: string, expectedRevision: number, actorId: string, action: FindingReviewHistory['action'], reason: string | null, idempotencyKey: string, createdAt: number): void { tx.insert(findingReviewActions).values({ id: this.uuid(), candidateId, expectedRevision, actorId, action, reason, idempotencyKey, createdAt }).onConflictDoNothing().run() }
}

export const deterministicPayloadHash = hash
export const normalizedCandidateText = normalized
