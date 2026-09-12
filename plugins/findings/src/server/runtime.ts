import type { FindingProducerContribution, FindingReviewTargetContribution, FindingWriter } from '../contract/extensions'
import { createHash } from 'node:crypto'
import type {
  FindingListOptions,
  FindingListPage,
  FindingObservation,
  FindingOrigin,
  FindingRecordInput,
  FindingRecordResult,
  FindingScope,
  FindingsChangedFrame,
} from '../contract/records'
import { FindingCapture, FindingCaptureError } from './capture'
import type { FindingBundle, FindingCandidateRevision } from '../contract/review'
import { FINDING_CANDIDATE_PAYLOAD_BYTES } from '../contract/review'
import { FindingsReviewStore, type FindingSynthesisResult } from './reviewStore'
import type { CoreServices } from '@acorn/plugin-api/node'
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'

type Emit = (frame: FindingsChangedFrame) => void

export class FindingsRuntime {
  #active = true
  readonly #capture: FindingCapture
  readonly #emit: Emit
  readonly #producerEntries: () => readonly { id: string; pluginId: string; value: FindingProducerContribution }[]
  readonly #targetEntries: () => readonly { id: string; pluginId: string; value: FindingReviewTargetContribution }[]
  readonly #review?: FindingsReviewStore
  readonly #core?: Pick<CoreServices, 'tasks' | 'models' | 'identity'> & Partial<Pick<CoreServices, 'projects'>>
  readonly #producerConnections = new Map<string, { token: object; disconnect?: () => void }>()
  readonly #targetConnections = new Map<string, { token: object; disconnect?: () => void }>()
  #onBundlePublished: ((bundle: FindingBundle) => void | Promise<void>) | null = null

  constructor(options: {
    capture: FindingCapture
    emit: Emit
    producerEntries: () => readonly { id: string; pluginId: string; value: FindingProducerContribution }[]
    targetEntries?: () => readonly { id: string; pluginId: string; value: FindingReviewTargetContribution }[]
    review?: FindingsReviewStore
    core?: Pick<CoreServices, 'tasks' | 'models' | 'identity'> & Partial<Pick<CoreServices, 'projects'>>
  }) {
    this.#capture = options.capture
    this.#emit = options.emit
    this.#producerEntries = options.producerEntries
    this.#targetEntries = options.targetEntries ?? (() => [])
    this.#review = options.review
    this.#core = options.core
  }

  #announce(scope: FindingScope, results: readonly FindingRecordResult[]): void {
    const changed = results.some((result) => result.created)
    if (changed) this.#emit({ channel: 'plugin:findings:observations-changed', scope, revision: results[0]!.revision })
  }

  async record(args: {
    scope: FindingScope
    origin: FindingOrigin
    producerId: string
    input: FindingRecordInput
    allowedKinds?: ReadonlySet<string>
  }): Promise<FindingRecordResult> {
    if (!this.#active) throw new FindingCaptureError('unavailable', 'findings is unavailable')
    const result = await this.#capture.record(args)
    this.#announce(args.scope, [result])
    return result
  }

  async recordBatch(args: {
    scope: FindingScope
    origin: FindingOrigin
    producerId: string
    inputs: readonly FindingRecordInput[]
    allowedKinds?: ReadonlySet<string>
  }): Promise<FindingRecordResult[]> {
    if (!this.#active) throw new FindingCaptureError('unavailable', 'findings is unavailable')
    const results = await this.#capture.recordBatch(args)
    this.#announce(args.scope, results)
    return results
  }

  listTask(taskId: string, options?: FindingListOptions): Promise<FindingListPage> {
    return this.#capture.listTask(taskId, options)
  }

  getTask(taskId: string, observationId: string): FindingObservation | null {
    return this.#capture.getTask(taskId, observationId)
  }

  candidate(id: string, revision?: number): FindingCandidateRevision | null { return this.#review?.candidate(id, revision) ?? null }
  bundles(scope: FindingScope, history = false): FindingBundle[] { return this.#review?.bundles(scope, history) ?? [] }
  observations(ids: readonly string[]): FindingObservation[] { return this.#capture.getMany(ids) }

  async bundlesForTask(taskId: string, history = false): Promise<FindingBundle[]> {
    const task = await this.#core?.tasks.load(taskId)
    if (!task?.projectId) throw new FindingCaptureError('not-found', 'task project is unavailable')
    return this.bundles({ kind: 'project', projectId: task.projectId }, history)
  }

  async modelBackends(): Promise<ModelBackend[]> {
    if (!this.#core) return []
    const userId = this.#core.identity.active()
    return userId ? this.#core.models.available(userId) : []
  }

  async importLegacyProposal(proposal: {
    id: string
    taskId: string
    projectId: string | null
    name: string
    type: string
    description: string
    body: string
    flags: string[]
    status: 'pending' | 'accepted' | 'rejected'
    createdAt: number
    originSessionId: string | null
  }): Promise<{ observationId: string; candidateId: string; revision: number; payloadHash: string }> {
    if (!this.#review) throw new FindingCaptureError('unavailable', 'findings review is unavailable')
    const targetEntry = this.#targetEntries().find((entry) => entry.id === 'memory:change')
    if (!targetEntry) throw new FindingCaptureError('unavailable', 'memory review target is unavailable')
    // Legacy files can outlive their project row. Keep those records reviewable as private history
    // instead of making a deleted project permanently block migration cutover.
    const liveProject = proposal.projectId ? await this.#core?.projects?.byId(proposal.projectId) : null
    const scope: FindingScope = liveProject ? { kind: 'project', projectId: liveProject.id } : { kind: 'private' }
    const recorded = await this.record({
      scope,
      origin: { kind: 'legacy', proposalId: proposal.id, ...(proposal.originSessionId ? { sessionId: proposal.originSessionId } : {}) },
      producerId: 'legacy-memory-proposals',
      input: {
        sourceKey: `proposal:${proposal.id}`,
        kind: 'findings:observation',
        kindVersion: 1,
        title: proposal.name.slice(0, 200),
        body: proposal.body,
        claimStatus: 'inferred',
        evidence: [],
      },
    })
    const payload = {
      operation: 'add',
      name: proposal.name,
      type: proposal.type,
      description: proposal.description,
      body: proposal.body,
      scope: scope.kind === 'project' ? { kind: 'project', projectId: scope.projectId } : { kind: 'private' },
    }
    const validation = await targetEntry.value.validate({ scope, payload })
    const imported = this.#review.importLegacy({
      legacyId: proposal.id,
      scope,
      observationId: recorded.id,
      targetKind: targetEntry.id,
      targetVersion: targetEntry.value.version,
      validation: { ...validation, warnings: [...proposal.flags, ...validation.warnings] },
      status: proposal.status,
      createdAt: proposal.createdAt,
    })
    return { observationId: recorded.id, ...imported }
  }

  async prepareTask(taskId: string, options: { boundaryKey: string; backendId?: string; modelId?: string }): Promise<FindingBundle> {
    return this.#prepareTask(taskId, options, true)
  }

  async startPrepareTask(taskId: string, options: { boundaryKey: string; backendId?: string; modelId?: string }): Promise<FindingBundle> {
    return this.#prepareTask(taskId, options, false)
  }

  async #prepareTask(taskId: string, options: { boundaryKey: string; backendId?: string; modelId?: string }, waitForCompletion: boolean): Promise<FindingBundle> {
    if (!this.#active) throw new FindingCaptureError('unavailable', 'findings is unavailable')
    if (!this.#review || !this.#core) throw new FindingCaptureError('unavailable', 'findings review is unavailable')
    const review = this.#review, core = this.#core
    const task = await core.tasks.load(taskId)
    if (!task?.projectId) throw new FindingCaptureError('not-found', 'task project is unavailable')
    const targetEntry = this.#targetEntries().find((entry) => entry.id === 'memory:change')
    if (!targetEntry) throw new FindingCaptureError('unavailable', 'memory review target is unavailable')
    const scope: FindingScope = { kind: 'project', projectId: task.projectId }
    const persistedSource = review.preparationSourceForBoundary(scope, options.boundaryKey)
    if (persistedSource && persistedSource.taskId !== taskId) throw new FindingCaptureError('conflict', 'preparation boundary belongs to another source task')
    const frozenIds = review.preparationInputIdsForBoundary(scope, options.boundaryKey)
    const input = frozenIds ? this.#capture.getMany(frozenIds) : await this.#activeTaskObservations(taskId)
    if (frozenIds && input.length !== frozenIds.length) throw new FindingCaptureError('unavailable', 'one or more frozen preparation inputs are unavailable')
    const backendId = persistedSource ? persistedSource.backendId : options.backendId ?? null
    const modelId = persistedSource ? persistedSource.modelId : options.modelId ?? null
    let synthesize: ((observations: FindingObservation[]) => Promise<FindingSynthesisResult>) | undefined
    if (backendId) synthesize = async (observations) => {
      const userId = core.identity.active()
      if (!userId) throw new FindingCaptureError('forbidden', 'an active owner is required for model preparation')
      const chunks: FindingObservation[][] = []
      for (const observation of observations) {
        const current = chunks.at(-1), size = new TextEncoder().encode(JSON.stringify(observation)).byteLength
        const currentSize = current ? new TextEncoder().encode(JSON.stringify(current)).byteLength : 0
        if (!current || current.length >= 50 || currentSize + size > 32 * 1024) chunks.push([observation])
        else current.push(observation)
      }
      const allGroups: Array<{ payload: unknown; sourceIds: string[]; explanation: string }> = []
      const allOmissions: Array<{ sourceId: string; reason: string }> = []
      let inputTokens = 0, outputTokens = 0, hasUsage = false
      for (const chunk of chunks) {
        const result = await core.models.generateText({ userId, backendId, timeoutMs: 60_000, input: {
          system: 'Return JSON only: {"candidates":[{"payload": memoryChange, "sourceIds":[ids], "explanation":"reason"}], "omitted":[{"sourceId":"id","reason":"reason"}]}. Use only supplied source IDs. Keep contradictions separate. Zero candidates is valid.',
          prompt: JSON.stringify({ observations: chunk.map(({ id, title, body, claimStatus }) => ({ id, title, body, claimStatus })) }),
          ...(modelId ? { modelId } : {}),
          maxOutputTokens: 8_000,
        } })
        const text = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
        if (result.usage) { hasUsage = true; inputTokens += result.usage.inputTokens ?? 0; outputTokens += result.usage.outputTokens ?? 0 }
        if (new TextEncoder().encode(text).byteLength > FINDING_CANDIDATE_PAYLOAD_BYTES) throw new FindingCaptureError('invalid-input', 'synthesis result exceeds the candidate payload limit')
        const parsed = JSON.parse(text) as { candidates?: unknown; omitted?: unknown }
        if (!Array.isArray(parsed.candidates)) throw new FindingCaptureError('invalid-input', 'synthesis result has no candidates array')
        const groups = parsed.candidates.map((item) => {
          if (!item || typeof item !== 'object') throw new FindingCaptureError('invalid-input', 'synthesis candidate is invalid')
          const row = item as Record<string, unknown>
          if (!Array.isArray(row.sourceIds) || row.sourceIds.some((id) => typeof id !== 'string') || typeof row.explanation !== 'string') throw new FindingCaptureError('invalid-input', 'synthesis candidate source IDs are invalid')
          return { payload: row.payload, sourceIds: row.sourceIds as string[], explanation: row.explanation }
        })
        const accounted = new Map<string, number>()
        for (const sourceId of groups.flatMap((group) => group.sourceIds)) accounted.set(sourceId, (accounted.get(sourceId) ?? 0) + 1)
        if (Array.isArray(parsed.omitted)) for (const omitted of parsed.omitted) {
          if (!omitted || typeof omitted !== 'object' || typeof (omitted as Record<string, unknown>).sourceId !== 'string' || typeof (omitted as Record<string, unknown>).reason !== 'string') throw new FindingCaptureError('invalid-input', 'synthesis omission is invalid')
          const row = omitted as { sourceId: string; reason: string }
          accounted.set(row.sourceId, (accounted.get(row.sourceId) ?? 0) + 1)
          allOmissions.push(row)
        }
        if (accounted.size !== chunk.length || chunk.some((observation) => accounted.get(observation.id) !== 1)) throw new FindingCaptureError('invalid-input', 'synthesis must account for every source ID exactly once as included or omitted')
        allGroups.push(...groups)
      }
      return { groups: allGroups, omissions: allOmissions, ...(hasUsage ? { usage: { inputTokens, outputTokens } } : {}) }
    }
    const preparation = review.prepare({ scope, sourceTaskId: taskId, boundaryKey: options.boundaryKey, ...(backendId ? { backendId } : {}), ...(modelId ? { modelId } : {}), targetKind: targetEntry.id, target: targetEntry.value, observations: input, ...(synthesize ? { synthesize } : {}) })
    const finish = async (): Promise<FindingBundle> => {
      let bundle: FindingBundle
      try { bundle = await preparation }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        try { bundle = review.failPreparation(scope, options.boundaryKey, message) } catch { throw error }
      }
      this.#emit({ channel: 'plugin:findings:review-changed', scope, revision: bundle.revision })
      this.#publishBundle(bundle)
      return bundle
    }
    if (waitForCompletion) return finish()
    const started = review.bundles(scope, true).find((bundle) => bundle.boundaryKey === options.boundaryKey)
    if (!started) return finish()
    this.#emit({ channel: 'plugin:findings:review-changed', scope, revision: started.revision })
    void finish().catch(() => undefined)
    return started
  }

  async #activeTaskObservations(taskId: string): Promise<FindingObservation[]> {
    const observations: FindingObservation[] = []
    let cursor: string | undefined
    do {
      const page = await this.#capture.listTask(taskId, { state: 'active', limit: 100, ...(cursor ? { cursor } : {}) })
      observations.push(...page.items)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    return observations
  }

  #publishBundle(bundle: FindingBundle): void {
    const listener = this.#onBundlePublished
    if (!listener) return
    try {
      void Promise.resolve(listener(bundle)).catch(() => undefined)
    } catch {
      // Delivery is optional and receipt-backed. Preparation remains successful when preferences or
      // notification transport are unavailable; a later regeneration/reconnect can deliver it.
    }
  }

  async editCandidate(args: { id: string; expectedRevision: number; payload: unknown; actorId: string; idempotencyKey: string }): Promise<FindingCandidateRevision> {
    if (!this.#review) throw new FindingCaptureError('unavailable', 'findings review is unavailable')
    const current = this.#review.candidate(args.id)
    if (!current) throw new FindingCaptureError('not-found', 'candidate not found')
    const target = this.#targetEntries().find((entry) => entry.id === current.targetKind)?.value
    if (!target) throw new FindingCaptureError('unavailable', 'review target is unavailable')
    const validation = await target.validate({ scope: current.scope, payload: args.payload })
    const updated = this.#review.edit(args.id, args.expectedRevision, validation.payload, validation, args.actorId, args.idempotencyKey)
    this.#emit({ channel: 'plugin:findings:review-changed', scope: updated.scope, revision: updated.revision }); return updated
  }
  decideCandidate(args: Parameters<FindingsReviewStore['decide']>[0]): FindingCandidateRevision { if (!this.#review) throw new FindingCaptureError('unavailable', 'findings review is unavailable'); const updated = this.#review.decide(args); this.#emit({ channel: 'plugin:findings:review-changed', scope: updated.scope, revision: updated.revision }); return updated }
  history(candidateId: string) { return this.#review?.history(candidateId) ?? [] }
  cancelPreparation(bundleId: string): FindingBundle { if (!this.#review) throw new FindingCaptureError('unavailable', 'findings review is unavailable'); const bundle = this.#review.cancelPreparation(bundleId); this.#emit({ channel: 'plugin:findings:review-changed', scope: bundle.scope, revision: bundle.revision }); return bundle }
  async retryPreparation(bundleId: string): Promise<FindingBundle> {
    if (!this.#review) throw new FindingCaptureError('unavailable', 'findings review is unavailable')
    const source = this.#review.preparationSource(bundleId)
    return this.startPrepareTask(source.taskId, {
      boundaryKey: source.boundaryKey,
      ...(source.backendId ? { backendId: source.backendId } : {}),
      ...(source.modelId ? { modelId: source.modelId } : {}),
    })
  }
  restoreObservation(args: Parameters<FindingsReviewStore['restoreObservation']>[0]): FindingBundle { if (!this.#review) throw new FindingCaptureError('unavailable', 'findings review is unavailable'); const bundle = this.#review.restoreObservation(args); this.#emit({ channel: 'plugin:findings:review-changed', scope: bundle.scope, revision: bundle.revision }); return bundle }
  splitCandidate(args: Parameters<FindingsReviewStore['splitCandidate']>[0]): FindingBundle { if (!this.#review) throw new FindingCaptureError('unavailable', 'findings review is unavailable'); const bundle = this.#review.splitCandidate(args); this.#emit({ channel: 'plugin:findings:review-changed', scope: bundle.scope, revision: bundle.revision }); return bundle }

  withdrawTask(args: { taskId: string; observationId: string; actor: { kind: 'agent' | 'device'; id: string }; reason?: string }): { changed: boolean; revision: number } {
    if (!this.#active) throw new FindingCaptureError('unavailable', 'findings is unavailable')
    const result = this.#capture.withdrawTask(args)
    if (result.changed) this.#emit({ channel: 'plugin:findings:observations-changed', scope: { kind: 'task', taskId: args.taskId }, revision: result.revision })
    return result
  }

  connectProducers(): void {
    for (const connection of this.#producerConnections.values()) {
      try { connection.disconnect?.() } catch { /* A reloaded worker may already have revoked its proxy. */ }
    }
    this.#producerConnections.clear()
    const entries = this.#producerEntries()
    for (const entry of entries) {
      const token = {}
      const localKinds = new Set(entry.value.kinds)
      if ([...localKinds].some((kind) => !/^[a-z][a-z0-9-]*$/.test(kind))) {
        throw new Error(`Findings producer '${entry.id}' declares an invalid local kind id.`)
      }
      const allowedKinds = new Set([...localKinds].map((kind) => `${entry.pluginId}:${kind}`))
      const available = () => this.#active && this.#producerConnections.get(entry.id)?.token === token
      const writer: FindingWriter = {
        record: async (scope, input) => {
          if (!available()) throw new FindingCaptureError('unavailable', `findings producer '${entry.id}' is unavailable`)
          return this.record({
            scope,
            origin: { kind: 'plugin', pluginId: entry.pluginId, invocationId: input.sourceKey },
            producerId: entry.id,
            input,
            allowedKinds,
          })
        },
        recordBatch: async (scope, inputs) => {
          if (!available()) throw new FindingCaptureError('unavailable', `findings producer '${entry.id}' is unavailable`)
          const invocationId = inputs.length === 1
            ? inputs[0]!.sourceKey
            : `batch:${createHash('sha256').update(inputs.map((input) => input.sourceKey).join('\0')).digest('hex')}`
          return this.recordBatch({
            scope,
            origin: { kind: 'plugin', pluginId: entry.pluginId, invocationId },
            producerId: entry.id,
            inputs,
            allowedKinds,
          })
        },
      }
      const disconnect = entry.value.connect(writer)
      this.#producerConnections.set(entry.id, { token, ...(disconnect ? { disconnect } : {}) })
    }
  }

  connectTargets(): void {
    if (!this.#review) return
    for (const connection of this.#targetConnections.values()) {
      try { connection.disconnect?.() } catch { /* A reloaded worker may already have revoked its proxy. */ }
    }
    this.#targetConnections.clear()
    const review = this.#review
    const entries = this.#targetEntries()
    for (const entry of entries) {
      const token = {}
      const available = () => this.#active && this.#targetConnections.get(entry.id)?.token === token
      const disconnect = entry.value.connect({
        applying: async (candidateId, revision, operationId) => { if (!available()) throw new FindingCaptureError('unavailable', 'review target is unavailable'); return review.transition(entry.id, candidateId, revision, operationId, 'applying') },
        applied: async (candidateId, revision, operationId, targetReference) => { if (!available()) throw new FindingCaptureError('unavailable', 'review target is unavailable'); return review.transition(entry.id, candidateId, revision, operationId, 'applied', targetReference) },
        conflict: async (candidateId, revision, operationId, reason) => { if (!available()) throw new FindingCaptureError('unavailable', 'review target is unavailable'); return review.transition(entry.id, candidateId, revision, operationId, 'conflict', reason) },
      })
      this.#targetConnections.set(entry.id, { token, ...(disconnect ? { disconnect } : {}) })
    }
  }

  /** Reconcile live extension entries after an installed plugin is enabled, disabled, or reloaded. */
  refreshContributors(): void {
    this.connectProducers()
    this.connectTargets()
  }

  onBundlePublished(listener: (bundle: FindingBundle) => void | Promise<void>): void {
    this.#onBundlePublished = listener
  }

  dispose(): void {
    this.#active = false
    this.#onBundlePublished = null
    const connections = [...this.#producerConnections.values(), ...this.#targetConnections.values()]
    this.#producerConnections.clear()
    this.#targetConnections.clear()
    for (const connection of connections.reverse()) {
      try { connection.disconnect?.() } catch { /* The contributing worker may already be gone. */ }
    }
  }
}
