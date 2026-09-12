import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { FindingReviewTargetContribution } from '../contract/extensions'
import type { FindingObservation } from '../contract/records'
import { findingPreparationJobs } from '../node/schema'
import { FindingsReviewStore } from './reviewStore'

const observation = (id: string, body = 'Use repository boundaries.'): FindingObservation => ({
  id, scope: { kind: 'task', taskId: 'task-1' }, scopeLabels: {}, origin: { kind: 'agent', sessionId: 'session-1' },
  kind: { id: 'findings:observation', version: 1, label: 'Observation', available: true }, title: 'Repository boundaries',
  body, claimStatus: 'observed', sourceKey: id, evidence: [], createdAt: 1, withdrawal: null,
})
const target = (accepted: string[] = []): FindingReviewTargetContribution => ({
  version: 1,
  acceptedFingerprints: async () => accepted,
  validate: async ({ payload }) => ({ payload, payloadHash: JSON.stringify(payload), fingerprint: JSON.stringify(payload), subjectKey: 'repository-boundaries', warnings: [] }),
  connect: () => {},
})

describe('consolidated findings review', () => {
  let db: TestPluginDb, store: FindingsReviewStore, sequence: number
  beforeEach(() => { db = makeTestPluginDb('findings'); sequence = 0; store = new FindingsReviewStore(db.db, () => 1_700_000_000_000 + sequence, () => `id-${++sequence}`) })
  afterEach(() => db.cleanup())

  it('publishes immutable revisions and deterministically deduplicates outstanding candidates', async () => {
    const first = await store.prepare({ scope: { kind: 'project', projectId: 'project-1' }, boundaryKey: 'manual:1', targetKind: 'memory:change', target: target(), observations: [observation('o1')] })
    expect(first.candidates).toHaveLength(1)
    const second = await store.prepare({ scope: { kind: 'project', projectId: 'project-1' }, boundaryKey: 'manual:2', targetKind: 'memory:change', target: target(), observations: [observation('o2')] })
    expect(second.candidates).toHaveLength(0)
    expect(second.outcomes).toMatchObject([{ observationId: 'o2', outcome: 'duplicate', candidateId: first.candidates[0]!.candidateId }])
    const edited = store.edit(first.candidates[0]!.candidateId, 1, { changed: true }, await target().validate({ scope: first.scope, payload: { changed: true } }), 'device-1', 'edit-1')
    expect(edited.revision).toBe(2)
    expect(store.candidate(edited.candidateId, 1)?.payload).not.toEqual(edited.payload)
    expect(() => store.edit(edited.candidateId, 1, {}, { payload: {}, payloadHash: '', fingerprint: '', subjectKey: '', warnings: [] }, 'device-1', 'edit-stale')).toThrow(/revision changed/)
  })

  it('suppresses exact dismissals, retains history, and undo restores readiness', async () => {
    const bundle = await store.prepare({ scope: { kind: 'project', projectId: 'project-1' }, boundaryKey: 'manual:1', targetKind: 'memory:change', target: target(), observations: [observation('o1')] })
    const candidate = bundle.candidates[0]!
    expect(store.decide({ candidateId: candidate.candidateId, expectedRevision: 1, actorId: 'device-1', action: 'dismiss', idempotencyKey: 'dismiss-1' }).status).toBe('dismissed')
    expect(store.decide({ candidateId: candidate.candidateId, expectedRevision: 1, actorId: 'device-1', action: 'dismiss-reason', reason: 'task-specific', idempotencyKey: 'dismiss-reason-1' }).status).toBe('dismissed')
    const retry = await store.prepare({ scope: bundle.scope, boundaryKey: 'manual:2', targetKind: 'memory:change', target: target(), observations: [observation('o2')] })
    expect(retry.outcomes[0]?.outcome).toBe('suppressed')
    expect(store.decide({ candidateId: candidate.candidateId, expectedRevision: 1, actorId: 'device-1', action: 'undo-dismiss', idempotencyKey: 'undo-1' }).status).toBe('ready')
    expect(new Set(store.history(candidate.candidateId).map((row) => row.action))).toEqual(new Set(['dismiss', 'dismiss-reason', 'undo-dismiss']))
  })

  it('binds target transitions to the owning target, source state, and exact operation', async () => {
    const first = await store.prepare({ scope: { kind: 'project', projectId: 'project-1' }, boundaryKey: 'manual:target-1', targetKind: 'memory:change', target: target(), observations: [observation('o1')] })
    const second = await store.prepare({ scope: { kind: 'project', projectId: 'project-1' }, boundaryKey: 'manual:target-2', targetKind: 'memory:change', target: target(), observations: [observation('o2', 'A distinct second finding.')] })
    const candidate = first.candidates[0]!
    const other = second.candidates[0]!

    expect(() => store.transition('other:target', candidate.candidateId, 1, 'operation-1', 'applying')).toThrow(/does not own/)
    expect(store.transition('memory:change', candidate.candidateId, 1, 'operation-1', 'applying')).toMatchObject({ status: 'applying' })
    expect(store.transition('memory:change', candidate.candidateId, 1, 'operation-1', 'applying')).toMatchObject({ status: 'applying' })
    expect(() => store.transition('memory:change', other.candidateId, 1, 'operation-1', 'applying')).toThrow(/different candidate transition/)
    expect(store.transition('memory:change', candidate.candidateId, 1, 'operation-1', 'applied', 'memory-1')).toMatchObject({ status: 'applied' })
    expect(() => store.transition('memory:change', candidate.candidateId, 1, 'operation-2', 'conflict', 'late')).toThrow(/cannot transition/)

    const dismissed = await store.prepare({ scope: { kind: 'project', projectId: 'project-1' }, boundaryKey: 'manual:dismiss-race', targetKind: 'memory:change', target: target(), observations: [observation('o3', 'A third distinct finding.')] })
    const dismissedCandidate = dismissed.candidates[0]!
    store.decide({ candidateId: dismissedCandidate.candidateId, expectedRevision: 1, actorId: 'device-1', action: 'dismiss', idempotencyKey: 'dismiss-race' })
    expect(() => store.transition('memory:change', dismissedCandidate.candidateId, 1, 'operation-3', 'applying')).toThrow(/cannot transition/)
  })

  it('retains completed chunks on cancellation and resumes only frozen pending input', async () => {
    let release!: () => void, markSecondStarted!: () => void, calls = 0
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const secondStarted = new Promise<void>((resolve) => { markSecondStarted = resolve })
    const inputs = Array.from({ length: 51 }, (_, index) => observation(`o${index + 1}`, `Body ${index + 1}`))
    const running = store.prepare({ scope: { kind: 'project', projectId: 'project-1' }, boundaryKey: 'manual:cancel', backendId: 'connection:model-1', modelId: 'fixture-model', targetKind: 'memory:change', target: target(), observations: inputs, synthesize: async (items) => {
      calls += 1
      if (calls === 2) { markSecondStarted(); await blocked }
      return { groups: [{ payload: { body: `chunk-${calls}` }, sourceIds: items.map((item) => item.id), explanation: 'Generated.' }], omissions: [] }
    } })
    await secondStarted
    const preparing = store.bundles({ kind: 'project', projectId: 'project-1' }, true)[0]!
    expect(preparing.state).toBe('preparing')
    expect(preparing).toMatchObject({ inputCount: 51, pendingCount: 1 })
    expect(preparing.candidates).toHaveLength(1)
    expect((await store.prepare({ scope: preparing.scope, boundaryKey: 'manual:cancel', targetKind: 'memory:change', target: target(), observations: inputs })).state).toBe('preparing')
    await expect(store.prepare({ scope: preparing.scope, boundaryKey: 'manual:other', targetKind: 'memory:change', target: target(), observations: [observation('o2')] })).rejects.toMatchObject({ kind: 'conflict' })
    expect(store.cancelPreparation(preparing.id).state).toBe('cancelled')
    release()
    expect((await running).state).toBe('cancelled')
    expect(store.bundles({ kind: 'project', projectId: 'project-1' }, true)[0]!.candidates).toHaveLength(1)
    store = new FindingsReviewStore(db.db, () => 1_700_000_000_000 + sequence, () => `id-${++sequence}`)
    expect(store.preparationSource(preparing.id)).toEqual({ taskId: 'task-1', boundaryKey: 'manual:cancel', backendId: 'connection:model-1', modelId: 'fixture-model' })
    const resumed = await store.prepare({ scope: preparing.scope, boundaryKey: 'manual:cancel', targetKind: 'memory:change', target: target(), observations: [...inputs, observation('new-input')], synthesize: async (items) => ({ groups: [{ payload: { body: 'resumed' }, sourceIds: items.map((item) => item.id), explanation: 'Resumed.' }], omissions: [] }) })
    expect(resumed).toMatchObject({ state: 'ready', inputCount: 51, pendingCount: 0, backendId: 'connection:model-1', modelId: 'fixture-model' })
    expect(resumed.candidates).toHaveLength(2)
    expect(resumed.outcomes).toHaveLength(51)
  })

  it('keeps synthesis omission reasons and marks materially changed successors after dismissal', async () => {
    const firstPayload = { body: 'first' }
    const changedTarget: FindingReviewTargetContribution = {
      ...target(),
      validate: async ({ payload }) => ({ payload, payloadHash: JSON.stringify(payload), fingerprint: JSON.stringify(payload), subjectKey: 'same-subject', warnings: [] }),
    }
    const first = await store.prepare({ scope: { kind: 'project', projectId: 'project-1' }, boundaryKey: 'manual:first', targetKind: 'memory:change', target: changedTarget, observations: [observation('o1')], synthesize: async () => ({ groups: [{ payload: firstPayload, sourceIds: ['o1'], explanation: 'First.' }], omissions: [] }) })
    store.decide({ candidateId: first.candidates[0]!.candidateId, expectedRevision: 1, actorId: 'device-1', action: 'dismiss', idempotencyKey: 'dismiss-changed' })
    const second = await store.prepare({ scope: first.scope, boundaryKey: 'manual:second', backendId: 'connection:model-1', modelId: 'fixture-model', targetKind: 'memory:change', target: changedTarget, observations: [observation('o2'), observation('o3')], synthesize: async () => ({ groups: [{ payload: { body: 'materially changed' }, sourceIds: ['o2'], explanation: 'Changed.' }], omissions: [{ sourceId: 'o3', reason: 'Too task-specific.' }], usage: { inputTokens: 20, outputTokens: 5 } }) })
    expect(second.candidates[0]?.warnings).toContain('Updated since dismissal.')
    expect(second.outcomes).toContainEqual(expect.objectContaining({ observationId: 'o3', outcome: 'not-selected', explanation: 'Too task-specific.' }))
    expect(db.db.select().from(findingPreparationJobs).all().find((job) => job.boundaryKey === 'manual:second')).toMatchObject({ sourceTaskId: 'task-1', backendId: 'connection:model-1', modelId: 'fixture-model', usageJson: JSON.stringify({ inputTokens: 20, outputTokens: 5 }) })
    expect(second).toMatchObject({ backendId: 'connection:model-1', modelId: 'fixture-model' })
    const restored = store.restoreObservation({ bundleId: second.id, observationId: 'o3', candidateId: second.candidates[0]!.candidateId, expectedRevision: 1, actorId: 'device-1', idempotencyKey: 'restore-o3' })
    expect(restored.candidates[0]?.sourceObservationIds).toEqual(['o2', 'o3'])
    const split = store.splitCandidate({ bundleId: second.id, candidateId: second.candidates[0]!.candidateId, expectedRevision: 1, observationIds: ['o3'], actorId: 'device-1', idempotencyKey: 'split-o3' })
    expect(split.candidates).toHaveLength(2)
    expect(split.outcomes.find((outcome) => outcome.observationId === 'o3')).toMatchObject({ outcome: 'candidate', candidateId: split.candidates[1]!.candidateId })
    expect(store.history(second.candidates[0]!.candidateId).map((entry) => entry.action)).toEqual(['split', 'restore'])
  })

  it('records the fixed legacy-to-consolidated fixture without merging a contradiction', async () => {
    const inputs = [
      observation('repeat-1', 'Use repository owners.'),
      observation('repeat-2', 'Use repository owners.'),
      observation('novel', 'Bound certificate generation.'),
      observation('contradiction', 'Direct database reads are required here.'),
      observation('task-only', 'Rename the temporary branch.'),
    ]
    const result = await store.prepare({
      scope: { kind: 'project', projectId: 'project-1' }, boundaryKey: 'fixture:legacy-comparison', targetKind: 'memory:change', target: target(), observations: inputs,
      synthesize: async () => ({
        groups: [
          { payload: { body: 'Use repository owners.' }, sourceIds: ['repeat-1'], explanation: 'Reusable boundary.' },
          { payload: { body: 'Use repository owners.' }, sourceIds: ['repeat-2'], explanation: 'Repeated boundary.' },
          { payload: { body: 'Bound certificate generation.' }, sourceIds: ['novel'], explanation: 'Reusable reliability lesson.' },
          { payload: { body: 'Direct database reads are required here.' }, sourceIds: ['contradiction'], explanation: 'Contradictory evidence retained separately.' },
        ],
        omissions: [{ sourceId: 'task-only', reason: 'Task-specific.' }],
      }),
    })

    expect(result).toMatchObject({ inputCount: 5, pendingCount: 0, state: 'ready' })
    expect(result.candidates).toHaveLength(3)
    expect(result.candidates.find((entry) => (entry.payload as { body: string }).body === 'Use repository owners.')?.sourceObservationIds).toEqual(['repeat-1', 'repeat-2'])
    expect(result.candidates.some((entry) => (entry.payload as { body: string }).body === 'Direct database reads are required here.')).toBe(true)
    expect(result.outcomes).toContainEqual(expect.objectContaining({ observationId: 'task-only', outcome: 'not-selected', explanation: 'Task-specific.' }))
  })

  it('reconciles a legacy verdict recorded while findings was disabled without another candidate', () => {
    const validation = { payload: { body: 'Keep owner boundaries.' }, payloadHash: 'payload-hash', fingerprint: 'fingerprint', subjectKey: 'owner-boundaries', warnings: ['verified'] }
    const input = { legacyId: 'legacy-1', scope: { kind: 'project' as const, projectId: 'project-1' }, observationId: 'observation-1', targetKind: 'memory:change', targetVersion: 1, validation, createdAt: 1 }
    const imported = store.importLegacy({ ...input, status: 'pending' })
    expect(store.candidate(imported.candidateId)?.status).toBe('ready')
    expect(store.importLegacy({ ...input, status: 'accepted' })).toEqual(imported)
    expect(store.candidate(imported.candidateId)?.status).toBe('applied')
    expect(store.history(imported.candidateId).map((entry) => entry.action)).toEqual(['applied'])
    expect(() => store.importLegacy({ ...input, status: 'rejected' })).toThrow(/lifecycle changed incompatibly/)
  })
})
