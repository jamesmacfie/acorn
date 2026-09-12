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
    const reviewRuntime = new FindingsRuntime({
      capture,
      emit,
      producerEntries: () => [],
      targetEntries: () => [
        { id: 'memory:change', pluginId: 'memory', value: reviewTarget('memory:change') },
        { id: 'other:change', pluginId: 'other', value: reviewTarget('other:change') },
      ],
      review: new FindingsReviewStore(ctx.storage.open()),
      core: ctx.core,
    })
    reviewRuntime.connectTargets()
    const bundle = await reviewRuntime.prepareTask('task', { boundaryKey: 'manual:owner-bound' })
    const candidate = bundle.candidates[0]!

    await expect(controllers.get('other:change')!.applying(candidate.candidateId, candidate.revision, 'other-operation'))
      .rejects.toMatchObject({ kind: 'forbidden' })
    await expect(controllers.get('memory:change')!.applying(candidate.candidateId, candidate.revision, 'memory-operation'))
      .resolves.toMatchObject({ status: 'applying' })
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
        text: JSON.stringify({ candidates: [{ payload: { body: 'Synthesized' }, sourceIds: [recorded.id], explanation: 'Valid.' }], omitted: [] }),
        providerId: 'fixture', backendId: 'connection:model-1', modelId: 'fixture-model',
      })
    const reviewTarget: FindingReviewTargetContribution = {
      version: 1, connect: () => {}, acceptedFingerprints: async () => [],
      validate: async ({ payload }) => ({ payload, payloadHash: JSON.stringify(payload), fingerprint: JSON.stringify(payload), subjectKey: 'subject', warnings: [] }),
    }
    const reviewRuntime = new FindingsRuntime({ capture, emit, producerEntries: () => [], targetEntries: () => [{ id: 'memory:change', pluginId: 'memory', value: reviewTarget }], review: new FindingsReviewStore(ctx.storage.open()), core: { tasks: ctx.core.tasks, identity: ctx.core.identity, models: { ...ctx.core.models, generateText } } })
    const failed = await reviewRuntime.prepareTask('task', { boundaryKey: 'manual:model', backendId: 'connection:model-1', modelId: 'fixture-model' })
    expect(failed).toMatchObject({ state: 'failed', error: expect.stringContaining('exactly once') })
    expect(generateText).toHaveBeenCalledOnce()
    expect(generateText.mock.calls[0]?.[0]).toMatchObject({
      userId: 'owner', backendId: 'connection:model-1', timeoutMs: 60_000,
      input: { modelId: 'fixture-model' },
    })
    expect(failed).toMatchObject({ backendId: 'connection:model-1', modelId: 'fixture-model' })
    capture.withdrawTask({ taskId: 'task', observationId: recorded.id, actor: { kind: 'device', id: 'device-1' } })
    const restarted = new FindingsRuntime({ capture, emit, producerEntries: () => [], targetEntries: () => [{ id: 'memory:change', pluginId: 'memory', value: reviewTarget }], review: new FindingsReviewStore(ctx.storage.open()), core: { tasks: ctx.core.tasks, identity: ctx.core.identity, models: { ...ctx.core.models, generateText } } })
    expect(await restarted.retryPreparation(failed.id)).toMatchObject({ id: failed.id, state: 'preparing', backendId: 'connection:model-1', modelId: 'fixture-model' })
    for (let attempt = 0; attempt < 20 && generateText.mock.calls.length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(generateText.mock.calls[1]?.[0]).toMatchObject({
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
    const bundle = await reviewRuntime.prepareTask('task', { boundaryKey: 'manual:all-pages' })
    expect(bundle).toMatchObject({ state: 'ready', inputCount: 101, pendingCount: 0 })
    expect(bundle.outcomes).toHaveLength(101)
  })
})
