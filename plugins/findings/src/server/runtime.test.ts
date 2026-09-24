import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, schema, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { FindingProducerContribution, FindingReviewTargetContribution, FindingWriter } from '../contract/extensions'
import type { FindingTargetController } from '../contract/review'
import { FindingCapture } from './capture'
import { FindingsReviewStore } from './reviewStore'
import { FindingsRuntime } from './runtime'

describe('findings runtime', () => {
  let ctx: TestNodeContext
  let runtime: FindingsRuntime
  let entries: Array<{ id: string; pluginId: string; value: FindingProducerContribution }>
  let writer: FindingWriter | undefined
  const emit = vi.fn()
  const disconnect = vi.fn()

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'findings' }, userId: 'owner' })
    const now = Date.now()
    ctx.db.insert(schema.workspaces).values({ id: 'ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: now, updatedAt: now }).run()
    ctx.db.insert(schema.projects).values({ id: 'project', name: 'Acorn', path: ctx.dataDir, workspaceId: 'ws', createdAt: now, updatedAt: now }).run()
    ctx.db.insert(schema.tasks).values({ id: 'task', title: 'Task', origin: 'local', projectId: 'project', status: 'active', createdAt: now, updatedAt: now }).run()
    entries = [{
      id: 'scanner:scan',
      pluginId: 'scanner',
      value: { kinds: ['hazard'], connect: (bound) => { writer = bound; return disconnect } },
    }]
    runtime = new FindingsRuntime({
      capture: new FindingCapture({
        db: ctx.storage.open(), core: ctx.core,
        kinds: () => [
          { id: 'findings:observation', descriptor: { version: 1, label: 'Observation' } },
          { id: 'scanner:hazard', descriptor: { version: 1, label: 'Hazard' } },
        ],
      }),
      emit,
      producerEntries: () => entries,
    })
    emit.mockClear()
    disconnect.mockClear()
  })

  afterEach(() => ctx.cleanup())

  it('binds producer identity and emits once for an atomic capture batch', async () => {
    runtime.connectProducers()
    const results = await writer!.recordBatch({ kind: 'task', taskId: 'task' }, [
      { sourceKey: 'one', kind: 'scanner:hazard', kindVersion: 1, title: 'One', body: 'One', claimStatus: 'observed', evidence: [] },
      { sourceKey: 'two', kind: 'scanner:hazard', kindVersion: 1, title: 'Two', body: 'Two', claimStatus: 'inferred', evidence: [] },
    ])

    expect(results).toHaveLength(2)
    expect(emit).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledWith({ channel: 'plugin:findings:observations-changed', scope: { kind: 'task', taskId: 'task' }, revision: 1 })
    expect((await runtime.listTask('task', { state: 'history' })).items[0]?.origin).toMatchObject({ kind: 'plugin', pluginId: 'scanner' })
  })

  it('rejects undeclared kinds and revokes stale writers when the producer disappears', async () => {
    runtime.connectProducers()
    await expect(writer!.record({ kind: 'task', taskId: 'task' }, {
      sourceKey: 'wrong', kind: 'findings:observation', kindVersion: 1, title: 'Wrong', body: 'Wrong', claimStatus: 'observed', evidence: [],
    })).rejects.toMatchObject({ kind: 'forbidden' })

    entries = []
    runtime.refreshContributors()
    await expect(writer!.record({ kind: 'task', taskId: 'task' }, {
      sourceKey: 'stale', kind: 'scanner:hazard', kindVersion: 1, title: 'Stale', body: 'Stale', claimStatus: 'observed', evidence: [],
    })).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('disconnects producers and rejects writes after disposal', async () => {
    runtime.connectProducers()
    runtime.dispose()
    expect(disconnect).toHaveBeenCalledOnce()
    await expect(writer!.record({ kind: 'task', taskId: 'task' }, {
      sourceKey: 'late', kind: 'scanner:hazard', kindVersion: 1, title: 'Late', body: 'Late', claimStatus: 'observed', evidence: [],
    })).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('revokes and reconnects a producer replaced under the same public id', async () => {
    runtime.connectProducers()
    const staleWriter = writer!
    const replacementDisconnect = vi.fn()
    entries = [{
      id: 'scanner:scan',
      pluginId: 'scanner',
      value: { kinds: ['hazard'], connect: (bound) => { writer = bound; return replacementDisconnect } },
    }]

    runtime.refreshContributors()
    expect(disconnect).toHaveBeenCalledOnce()
    await expect(staleWriter.record({ kind: 'task', taskId: 'task' }, {
      sourceKey: 'stale-reload', kind: 'scanner:hazard', kindVersion: 1, title: 'Stale', body: 'Stale', claimStatus: 'observed', evidence: [],
    })).rejects.toMatchObject({ kind: 'unavailable' })
    await expect(writer!.record({ kind: 'task', taskId: 'task' }, {
      sourceKey: 'fresh-reload', kind: 'scanner:hazard', kindVersion: 1, title: 'Fresh', body: 'Fresh', claimStatus: 'observed', evidence: [],
    })).resolves.toMatchObject({ created: true })
  })

  it('binds each review completion controller to its contributing target', async () => {
    const capture = new FindingCapture({ db: ctx.storage.open(), core: ctx.core, kinds: () => [{ id: 'findings:observation', descriptor: { version: 1, label: 'Observation' } }] })
    await capture.record({
      scope: { kind: 'task', taskId: 'task' },
      origin: { kind: 'device', deviceId: 'device' },
      producerId: 'test',
      input: { sourceKey: 'owner-bound', kind: 'findings:observation', kindVersion: 1, title: 'Owner bound', body: 'Only the owning target can complete this candidate.', claimStatus: 'observed', evidence: [] },
    })
    const controllers = new Map<string, FindingTargetController>()
    const reviewTarget = (id: string): FindingReviewTargetContribution => ({
      version: 1,
      connect: (controller) => { controllers.set(id, controller) },
      acceptedFingerprints: async () => [],
      validate: async ({ payload }) => ({ payload, payloadHash: JSON.stringify(payload), fingerprint: JSON.stringify(payload), subjectKey: 'subject', warnings: [] }),
    })
    const targetEntries = [
      { id: 'memory:change', pluginId: 'memory', value: reviewTarget('memory:change') },
      { id: 'other:change', pluginId: 'other', value: reviewTarget('other:change') },
    ]
    const reviewRuntime = new FindingsRuntime({
      capture,
      emit,
      producerEntries: () => [],
      targetEntries: () => targetEntries,
      review: new FindingsReviewStore(ctx.storage.open()),
      core: ctx.core,
    })
    reviewRuntime.connectTargets()
    const bundle = await reviewRuntime.prepareTask('task', { boundaryKey: 'manual:owner-bound', targetId: 'memory:change' })
    const candidate = bundle.candidates[0]!

    await expect(controllers.get('other:change')!.applying(candidate.candidateId, candidate.revision, 'other-operation'))
      .rejects.toMatchObject({ kind: 'forbidden' })
    await expect(controllers.get('memory:change')!.applying(candidate.candidateId, candidate.revision, 'memory-operation'))
      .resolves.toMatchObject({ status: 'applying' })
    await capture.record({
      scope: { kind: 'task', taskId: 'task' }, origin: { kind: 'device', deviceId: 'device' }, producerId: 'test',
      input: { sourceKey: 'other-target', kind: 'findings:observation', kindVersion: 1, title: 'Other target', body: 'Selected for the other target.', claimStatus: 'observed', evidence: [] },
    })
    const other = await reviewRuntime.prepareTask('task', { boundaryKey: 'manual:other-target', targetId: 'other:change' })
    expect(other.candidates[0]?.targetKind).toBe('other:change')
    await expect(reviewRuntime.prepareTask('task', { boundaryKey: 'manual:other-target', targetId: 'memory:change' }))
      .rejects.toMatchObject({ kind: 'conflict' })
    targetEntries.pop()
    reviewRuntime.refreshContributors()
    await expect(reviewRuntime.retryPreparation(other.id)).rejects.toMatchObject({ kind: 'unavailable' })
    targetEntries.push({ id: 'other:change', pluginId: 'other', value: reviewTarget('other:change') })
    reviewRuntime.refreshContributors()
    expect((await reviewRuntime.retryPreparation(other.id)).id).toBe(other.id)
  })

  it('submits one atomic, idempotent proposal and stamps plugin origin on the public controller', async () => {
    const db = ctx.storage.open()
    const capture = new FindingCapture({ db, core: ctx.core, kinds: () => [{ id: 'findings:observation', descriptor: { version: 1, label: 'Observation' } }] })
    const review = new FindingsReviewStore(db)
    let controller!: FindingTargetController
    const target: FindingReviewTargetContribution = {
      version: 1, connect: (bound) => { controller = bound }, acceptedFingerprints: async () => [],
      validate: async ({ payload }) => ({ payload, payloadHash: JSON.stringify(payload), fingerprint: JSON.stringify(payload), subjectKey: 'subject', warnings: [] }),
    }
    const reviewRuntime = new FindingsRuntime({ capture, emit, producerEntries: () => [], targetEntries: () => [{ id: 'memory:change', pluginId: 'memory', value: target }], review, core: ctx.core })
    reviewRuntime.connectTargets()
    reviewRuntime.onBundlePublished(() => { throw new Error('notice transport failed') })
    const input = { taskId: 'task', sourceKey: 'tool-call-1', title: 'Keep boundaries', body: 'Use the owner boundary.', payload: { name: 'keep-boundaries' } }
    const first = await controller.submitProposal({ ...input, sessionId: 'forged-agent' } as typeof input)
    expect(await controller.submitProposal(input)).toEqual(first)
    expect(reviewRuntime.candidate(first.candidateId)).toMatchObject({ status: 'ready', targetKind: 'memory:change' })
    expect(reviewRuntime.bundles({ kind: 'project', projectId: 'project' }, true)).toHaveLength(1)
    expect((await reviewRuntime.listTask('task')).items).toMatchObject([{ origin: { kind: 'plugin', pluginId: 'memory', invocationId: 'tool-call-1' } }])

    const insert = vi.spyOn(review, 'submitProposal').mockImplementationOnce(() => { throw new Error('review insert failed') })
    await expect(controller.submitProposal({ ...input, sourceKey: 'tool-call-2' })).rejects.toThrow('review insert failed')
    expect((await reviewRuntime.listTask('task')).items).toHaveLength(1)
    insert.mockRestore()
    await expect(controller.submitProposal({ ...input, sourceKey: 'tool-call-1', payload: { name: 'different' } }))
      .rejects.toMatchObject({ kind: 'conflict' })
  })

  it('verifies agent provenance and revokes a target before an in-flight submission commits', async () => {
    const db = ctx.storage.open()
    const capture = new FindingCapture({ db, core: ctx.core, kinds: () => [{ id: 'findings:observation', descriptor: { version: 1, label: 'Observation' } }] })
    let controller!: FindingTargetController
    let release!: () => void
    let delayed = false
    const target: FindingReviewTargetContribution = {
      version: 1, connect: (bound) => { controller = bound }, acceptedFingerprints: async () => [],
      validate: async ({ payload }) => {
        if (delayed) await new Promise<void>((resolve) => { release = resolve })
        return { payload, payloadHash: JSON.stringify(payload), fingerprint: JSON.stringify(payload), subjectKey: 'subject', warnings: [] }
      },
    }
    let targets = [{ id: 'memory:change', pluginId: 'memory', value: target }]
    const reviewRuntime = new FindingsRuntime({ capture, emit, producerEntries: () => [], targetEntries: () => targets, review: new FindingsReviewStore(db), core: ctx.core })
    reviewRuntime.connectTargets()
    const input = { taskId: 'task', sessionId: 'session-1', proof: 'host-proof', sourceKey: 'agent-1', title: 'Agent proposal', body: 'Review this.', payload: { name: 'agent-proposal' } }
    await expect(reviewRuntime.submitAgentProposal(input, async () => false)).rejects.toMatchObject({ kind: 'forbidden' })
    await expect(reviewRuntime.submitAgentProposal({ ...input, taskId: 'other-task' }, async (taskId, sessionId) => taskId === 'task' && sessionId === 'session-1'))
      .rejects.toMatchObject({ kind: 'forbidden' })
    const accepted = await reviewRuntime.submitAgentProposal(input, async (taskId, sessionId, proof) => taskId === 'task' && sessionId === 'session-1' && proof === 'host-proof')
    expect(reviewRuntime.candidate(accepted.candidateId)?.status).toBe('ready')
    expect((await reviewRuntime.listTask('task')).items[0]?.origin).toMatchObject({ kind: 'agent', sessionId: 'session-1' })

    delayed = true
    const pending = controller.submitProposal({ taskId: 'task', sourceKey: 'plugin-delayed', title: 'Delayed', body: 'Review this.', payload: { name: 'delayed' } })
    for (let attempt = 0; !release && attempt < 20; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1))
    targets = []
    reviewRuntime.refreshContributors()
    release()
    await expect(pending).rejects.toMatchObject({ kind: 'unavailable' })
    expect((await reviewRuntime.listTask('task')).items).toHaveLength(1)
  })

  it('uses only the explicitly selected backend and rejects unaccounted source IDs', async () => {
    const capture = new FindingCapture({ db: ctx.storage.open(), core: ctx.core, kinds: () => [{ id: 'findings:observation', descriptor: { version: 1, label: 'Observation' } }] })
    const recorded = await capture.record({ scope: { kind: 'task', taskId: 'task' }, origin: { kind: 'device', deviceId: 'device' }, producerId: 'test', input: { sourceKey: 'model-one', kind: 'findings:observation', kindVersion: 1, title: 'One', body: 'One body', claimStatus: 'observed', evidence: [] } })
    const generateText = vi.fn()
      .mockResolvedValueOnce({
        text: JSON.stringify({ candidates: [{ payload: { body: 'Synthesized' }, sourceIds: ['wrong-id'], explanation: 'Wrong.' }], omitted: [] }),
        providerId: 'fixture', backendId: 'connection:model-1', modelId: 'fixture-model',
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({ candidates: [{ payload: { body: 'Still wrong' }, sourceIds: ['wrong-id'], explanation: 'Wrong again.' }], omitted: [] }),
        providerId: 'fixture', backendId: 'connection:model-1', modelId: 'fixture-model',
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({ candidates: [{ payload: { body: 'Synthesized' }, sourceIds: [recorded.id], explanation: 'Valid.' }], omitted: [] }),
        providerId: 'fixture', backendId: 'connection:model-1', modelId: 'fixture-model',
      })
    const reviewTarget: FindingReviewTargetContribution = {
      version: 1, connect: () => {}, acceptedFingerprints: async () => [],
      synthesisContext: async () => ({
        instructions: 'Create durable memory changes.',
        existing: [{ id: 'memory-1', name: 'existing-memory' }],
      }),
      validate: async ({ payload }) => ({ payload, payloadHash: JSON.stringify(payload), fingerprint: JSON.stringify(payload), subjectKey: 'subject', warnings: [] }),
    }
    const reviewRuntime = new FindingsRuntime({ capture, emit, producerEntries: () => [], targetEntries: () => [{ id: 'memory:change', pluginId: 'memory', value: reviewTarget }], review: new FindingsReviewStore(ctx.storage.open()), core: { tasks: ctx.core.tasks, identity: ctx.core.identity, models: { ...ctx.core.models, generateText } } })
    reviewRuntime.connectTargets()
    const failed = await reviewRuntime.prepareTask('task', { boundaryKey: 'manual:model', targetId: 'memory:change', backendId: 'connection:model-1', modelId: 'fixture-model' })
    expect(failed).toMatchObject({ state: 'failed', error: expect.stringContaining('exactly once') })
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(generateText.mock.calls[0]?.[0]).toMatchObject({
      userId: 'owner', backendId: 'connection:model-1', timeoutMs: 60_000,
      input: { modelId: 'fixture-model', system: expect.stringContaining('durable knowledge') },
    })
    expect(JSON.parse(generateText.mock.calls[0]?.[0].input.prompt)).toMatchObject({
      target: { instructions: 'Create durable memory changes.', existing: [{ id: 'memory-1', name: 'existing-memory' }] },
      observations: [{ id: recorded.id }],
    })
    expect(JSON.parse(generateText.mock.calls[1]?.[0].input.prompt)).toMatchObject({
      correction: { error: expect.stringContaining('exactly once') },
    })
    expect(failed).toMatchObject({ backendId: 'connection:model-1', modelId: 'fixture-model' })
    capture.withdrawTask({ taskId: 'task', observationId: recorded.id, actor: { kind: 'device', id: 'device-1' } })
    const restarted = new FindingsRuntime({ capture, emit, producerEntries: () => [], targetEntries: () => [{ id: 'memory:change', pluginId: 'memory', value: reviewTarget }], review: new FindingsReviewStore(ctx.storage.open()), core: { tasks: ctx.core.tasks, identity: ctx.core.identity, models: { ...ctx.core.models, generateText } } })
    restarted.connectTargets()
    expect(await restarted.retryPreparation(failed.id)).toMatchObject({ id: failed.id, state: 'preparing', backendId: 'connection:model-1', modelId: 'fixture-model' })
    for (let attempt = 0; attempt < 20 && generateText.mock.calls.length < 3; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(generateText.mock.calls[2]?.[0]).toMatchObject({
      userId: 'owner', backendId: 'connection:model-1', timeoutMs: 60_000,
      input: { modelId: 'fixture-model' },
    })
  })

  it('freezes every active observation across pages and contains optional publication failures', async () => {
    const capture = new FindingCapture({ db: ctx.storage.open(), core: ctx.core, kinds: () => [{ id: 'findings:observation', descriptor: { version: 1, label: 'Observation' } }] })
    const input = Array.from({ length: 101 }, (_, index) => ({
      sourceKey: `page-${index}`,
      kind: 'findings:observation',
      kindVersion: 1,
      title: `Finding ${index}`,
      body: `Distinct body ${index}`,
      claimStatus: 'observed' as const,
      evidence: [],
    }))
    await capture.recordBatch({ scope: { kind: 'task', taskId: 'task' }, origin: { kind: 'device', deviceId: 'device' }, producerId: 'test', inputs: input.slice(0, 100) })
    await capture.record({ scope: { kind: 'task', taskId: 'task' }, origin: { kind: 'device', deviceId: 'device' }, producerId: 'test', input: input[100]! })
    const reviewTarget: FindingReviewTargetContribution = {
      version: 1, connect: () => {}, acceptedFingerprints: async () => [],
      validate: async ({ payload }) => ({ payload, payloadHash: JSON.stringify(payload), fingerprint: JSON.stringify(payload), subjectKey: JSON.stringify(payload), warnings: [] }),
    }
    const reviewRuntime = new FindingsRuntime({ capture, emit, producerEntries: () => [], targetEntries: () => [{ id: 'memory:change', pluginId: 'memory', value: reviewTarget }], review: new FindingsReviewStore(ctx.storage.open()), core: ctx.core })
    reviewRuntime.onBundlePublished(async () => { throw new Error('optional notification unavailable') })
    reviewRuntime.connectTargets()
    const bundle = await reviewRuntime.prepareTask('task', { boundaryKey: 'manual:all-pages', targetId: 'memory:change' })
    expect(bundle).toMatchObject({ state: 'ready', inputCount: 101, pendingCount: 0 })
    expect(bundle.outcomes).toHaveLength(101)
  })
})
