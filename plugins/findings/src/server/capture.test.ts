import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext, schema, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { FindingRecordInput } from '../contract/records'
import { FindingCapture, FindingCaptureError } from './capture'

describe('finding capture', () => {
  let ctx: TestNodeContext
  let capture: FindingCapture
  let tick: number
  let id: number

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'findings' } })
    const now = 1_700_000_000_000
    ctx.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Workspace', isDefault: true, sort: 0, createdAt: now, updatedAt: now }).run()
    ctx.db.insert(schema.projects).values({ id: 'project-1', name: 'Acorn', path: ctx.dataDir, workspaceId: 'workspace-1', createdAt: now, updatedAt: now }).run()
    ctx.db.insert(schema.tasks).values([
      { id: 'task-1', title: 'First task', origin: 'local', projectId: 'project-1', status: 'active', createdAt: now, updatedAt: now },
      { id: 'task-2', title: 'Second task', origin: 'local', projectId: 'project-1', status: 'active', createdAt: now, updatedAt: now },
    ]).run()
    tick = now
    id = 0
    capture = new FindingCapture({
      db: ctx.storage.open(),
      core: ctx.core,
      kinds: () => [
        { id: 'findings:observation', descriptor: { version: 1, label: 'Observation' } },
        { id: 'scanner:hazard', descriptor: { version: 2, label: 'Hazard' } },
      ],
      now: () => tick++,
      uuid: () => `finding-${++id}`,
    })
  })

  afterEach(() => ctx.cleanup())

  const record = (sourceKey: string, overrides: Partial<FindingRecordInput> = {}) => capture.record({
    scope: { kind: 'task', taskId: 'task-1' },
    origin: { kind: 'agent', sessionId: 'session-1', turnId: 'turn-1' },
    producerId: 'findings:agent-tool',
    input: {
      sourceKey,
      kind: 'findings:observation',
      kindVersion: 1,
      title: `Finding ${sourceKey}`,
      body: 'Evidence-backed body.',
      claimStatus: 'observed',
      evidence: [{ kind: 'repository', path: 'src/app.ts', revision: 'abc123' }],
      ...overrides,
    },
  })

  it('is idempotent by trusted origin and source key and rejects conflicting reuse', async () => {
    const first = await record('stable-key')
    const repeat = await record('stable-key')

    expect(first).toEqual({ id: 'finding-1', created: true, revision: 1 })
    expect(repeat).toEqual({ id: first.id, created: false, revision: 1 })
    await expect(record('stable-key', { body: 'Changed payload.' })).rejects.toMatchObject({ kind: 'conflict' })
    expect((await capture.listTask('task-1', { state: 'history' })).items).toHaveLength(1)
  })

  it('coalesces one atomic batch into one scope revision and paginates deterministically', async () => {
    const inputs = ['one', 'two', 'three'].map((sourceKey) => ({
      sourceKey, kind: 'findings:observation', kindVersion: 1, title: sourceKey, body: sourceKey, claimStatus: 'inferred' as const, evidence: [],
    }))
    const results = await capture.recordBatch({
      scope: { kind: 'task', taskId: 'task-1' },
      origin: { kind: 'workflow', runId: 'run-1' },
      producerId: 'workflow:test',
      inputs,
    })

    expect(results.map((result) => result.revision)).toEqual([1, 1, 1])
    const first = await capture.listTask('task-1', { state: 'history', limit: 2 })
    const second = await capture.listTask('task-1', { state: 'history', limit: 2, cursor: first.nextCursor! })
    expect(first.items.map((item) => item.title)).toEqual(['three', 'two'])
    expect(second.items.map((item) => item.title)).toEqual(['one'])
    expect(second.nextCursor).toBeNull()
  })

  it('confines task reads, corrections, and repository evidence', async () => {
    const original = await record('original')
    await expect(capture.record({
      scope: { kind: 'task', taskId: 'task-2' },
      origin: { kind: 'agent', sessionId: 'session-2' },
      producerId: 'findings:agent-tool',
      input: { sourceKey: 'bad-correction', kind: 'findings:observation', kindVersion: 1, title: 'Wrong scope', body: 'No', claimStatus: 'observed', evidence: [], correctsObservationId: original.id },
    })).rejects.toMatchObject({ kind: 'invalid-input' })
    await expect(record('escape', { evidence: [{ kind: 'repository', path: '../secret.txt' }] })).rejects.toMatchObject({ kind: 'invalid-input' })
    expect(capture.getTask('task-2', original.id)).toBeNull()

    const correction = await record('correction', { correctsObservationId: original.id })
    expect(capture.getTask('task-1', correction.id)?.correctsObservationId).toBe(original.id)
  })

  it('keeps withdrawals as history and lets an agent withdraw only its own observation', async () => {
    const found = await record('withdraw-me')
    expect(() => capture.withdrawTask({ taskId: 'task-1', observationId: found.id, actor: { kind: 'agent', id: 'session-2' } }))
      .toThrowError(FindingCaptureError)

    expect(capture.withdrawTask({ taskId: 'task-1', observationId: found.id, actor: { kind: 'agent', id: 'session-1' }, reason: 'Superseded' }))
      .toEqual({ changed: true, revision: 2 })
    expect((await capture.listTask('task-1', { state: 'active' })).items).toEqual([])
    expect((await capture.listTask('task-1', { state: 'history' })).items[0]?.withdrawal).toMatchObject({
      actor: { kind: 'agent', id: 'session-1' }, reason: 'Superseded',
    })
  })

  it('retains the stored kind label when its contributor disappears', async () => {
    let kinds = [{ id: 'scanner:hazard', descriptor: { version: 2, label: 'Hazard' } }]
    capture = new FindingCapture({ db: ctx.storage.open(), core: ctx.core, kinds: () => kinds, now: () => tick++, uuid: () => `finding-${++id}` })
    await record('hazard', { kind: 'scanner:hazard', kindVersion: 2 })
    kinds = []

    expect((await capture.listTask('task-1', { state: 'history' })).items[0]?.kind).toEqual({
      id: 'scanner:hazard', version: 2, label: 'Hazard', available: false,
    })
  })
})
