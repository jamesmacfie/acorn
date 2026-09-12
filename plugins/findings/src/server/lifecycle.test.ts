import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, schema, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentReviewInputCapability } from '@acorn/plugin-agents/contract/lifecycle.ts'
import { findingLifecycleCheckpoints } from '../node/schema'
import { FindingsLifecycle, truncateLifecycleBody } from './lifecycle'
import type { FindingsRuntime } from './runtime'

describe('findings completion lifecycle', () => {
  let ctx: TestNodeContext
  const record = vi.fn(async () => ({ id: 'observation-1', revision: 1, created: true }))
  const startPrepareTask = vi.fn(async (_taskId: string, input: { boundaryKey: string }) => ({
    id: `bundle:${input.boundaryKey}`, scope: { kind: 'project' as const, projectId: 'project' }, boundaryKey: input.boundaryKey,
    revision: 1, state: 'preparing' as const, backendId: null, modelId: null, candidates: [], outcomes: [], inputCount: 1,
    pendingCount: 1, createdAt: 1, updatedAt: 1, error: null,
  }))
  const notice = vi.fn()

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'findings' }, userId: 'owner' })
    const now = Date.now()
    ctx.db.insert(schema.workspaces).values({ id: 'ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: now, updatedAt: now }).run()
    ctx.db.insert(schema.projects).values({ id: 'project', name: 'Project', path: ctx.dataDir, workspaceId: 'ws', createdAt: now, updatedAt: now }).run()
    ctx.db.insert(schema.tasks).values({ id: 'task', title: 'Task', origin: 'local', projectId: 'project', status: 'active', createdAt: now, updatedAt: now }).run()
    record.mockClear(); startPrepareTask.mockClear(); notice.mockClear()
  })
  afterEach(() => ctx.cleanup())

  const lifecycle = (agents?: AgentReviewInputCapability) => new FindingsLifecycle({
    db: ctx.storage.open(), runtime: { record, startPrepareTask } as unknown as FindingsRuntime,
    core: ctx.core, agents: () => agents, notice,
  })

  it('reconciles ordinary and workflow turns once without preparing per managed turn', async () => {
    const refs = [
      { taskId: 'task', sessionId: 'ordinary', turnId: 'one', source: 'interactive' as const, attempt: 1, purpose: 'ordinary' as const, completedSequence: 3, completedAt: 10 },
      { taskId: 'task', sessionId: 'workflow', turnId: 'two', source: 'workflow' as const, attempt: 1, purpose: 'workflow' as const, completedSequence: 5, completedAt: 20 },
    ]
    const agents: AgentReviewInputCapability = {
      listCompleted: async () => refs,
      read: async (input) => input.turnId === 'one'
        ? { ...refs[0]!, availability: 'available', assistantSummary: 'Reusable result.', userMessages: [], unavailableReason: null }
        : { ...refs[1]!, availability: 'available', assistantSummary: 'Step result.', userMessages: [], unavailableReason: null },
    }
    const owner = lifecycle(agents)
    await owner.reconcile()
    await owner.reconcile()

    expect(record).toHaveBeenCalledOnce()
    expect(startPrepareTask).not.toHaveBeenCalled()
    expect(ctx.storage.open().select().from(findingLifecycleCheckpoints).all()).toMatchObject([
      { boundaryKey: 'agent:ordinary:one:1:3', availability: 'available', observationId: 'observation-1' },
      { boundaryKey: 'agent:workflow:two:1:5', availability: 'unavailable', observationId: null },
    ])
  })

  it('prepares one top-level workflow boundary only when explicitly enabled', async () => {
    const owner = lifecycle()
    await owner.setSettings('owner', { automaticPreparation: true, notifyWhenReady: false, backendId: 'connection:model-1', modelId: 'fixture-model' })
    const boundary = {
      taskId: 'task', boundaryKey: 'workflow:run-1:terminal', sourceKind: 'workflow' as const,
      sourceVersion: 'terminal:failed', title: 'Workflow failed', body: 'Failure evidence', availability: 'available' as const, completedAt: 10,
    }
    await owner.boundary(boundary)
    await owner.boundary(boundary)
    expect(record).toHaveBeenCalledOnce()
    expect(startPrepareTask).toHaveBeenCalledOnce()
    expect(startPrepareTask).toHaveBeenCalledWith('task', { boundaryKey: boundary.boundaryKey, backendId: 'connection:model-1', modelId: 'fixture-model' })
  })

  it('keeps notifications passive by default and emits at most one per enabled bundle', async () => {
    const owner = lifecycle()
    const bundle = { id: 'bundle-1', boundaryKey: 'manual:task:notice', scope: { kind: 'project' }, candidates: [{}], state: 'ready' }
    await owner.bundlePublished(bundle)
    expect(notice).not.toHaveBeenCalled()
    await owner.setSettings('owner', { automaticPreparation: false, notifyWhenReady: true, backendId: null, modelId: null })
    await owner.bundlePublished(bundle)
    await owner.bundlePublished(bundle)
    expect(notice).toHaveBeenCalledOnce()
    expect(notice).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task', target: { kind: 'findings-bundle', resourceId: 'bundle-1' } }))
  })

  it('truncates lifecycle bodies on a valid UTF-8 boundary within the byte ceiling', async () => {
    const body = '€'.repeat(6_000)
    const truncated = truncateLifecycleBody(body)
    expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(16 * 1024)
    expect(truncated).not.toContain('�')
    await lifecycle().boundary({
      taskId: 'task', boundaryKey: 'terminal:utf8:exit', sourceKind: 'terminal', sourceVersion: 'exit:0',
      title: 'Terminal exited', body, availability: 'available', completedAt: 10,
    })
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ body: truncated }) }))
  })

  it('releases the notification receipt when delivery fails so a retry can succeed', async () => {
    const failingNotice = vi.fn().mockImplementationOnce(() => { throw new Error('transport unavailable') })
    const owner = new FindingsLifecycle({
      db: ctx.storage.open(), runtime: { record, startPrepareTask } as unknown as FindingsRuntime,
      core: ctx.core, agents: () => undefined, notice: failingNotice,
    })
    await owner.setSettings('owner', { automaticPreparation: false, notifyWhenReady: true, backendId: null, modelId: null })
    const bundle = { id: 'bundle-retry', boundaryKey: 'manual:task:notice-retry', scope: { kind: 'project' }, candidates: [{}], state: 'ready' }
    await expect(owner.bundlePublished(bundle)).rejects.toThrow('transport unavailable')
    await expect(owner.bundlePublished(bundle)).resolves.toBeUndefined()
    expect(failingNotice).toHaveBeenCalledTimes(2)
  })
})
