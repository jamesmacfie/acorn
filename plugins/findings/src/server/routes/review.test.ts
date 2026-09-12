import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PluginRequestContext, Principal } from '@acorn/plugin-api/node'
import { makeTestNodeContext, schema, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { FindingReviewTargetContribution } from '../../contract/extensions'
import { FindingCapture } from '../capture'
import { FindingsReviewStore } from '../reviewStore'
import { FindingsRuntime } from '../runtime'
import { findingsReviewRoutes } from './review'
import { portableFetch } from './carrier'

describe('findings review device routes', () => {
  let ctx: TestNodeContext, runtime: FindingsRuntime
  const target: FindingReviewTargetContribution = {
    version: 1, connect: () => {}, acceptedFingerprints: async () => [],
    validate: async ({ payload }) => ({ payload, payloadHash: JSON.stringify(payload), fingerprint: JSON.stringify(payload), subjectKey: 'subject', warnings: [] }),
  }
  beforeEach(async () => {
    ctx = makeTestNodeContext({ plugin: { name: 'findings' } }); const now = Date.now()
    ctx.db.insert(schema.workspaces).values({ id: 'ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: now, updatedAt: now }).run()
    ctx.db.insert(schema.projects).values({ id: 'project', name: 'Acorn', path: ctx.dataDir, workspaceId: 'ws', createdAt: now, updatedAt: now }).run()
    ctx.db.insert(schema.tasks).values({ id: 'task', title: 'Task', origin: 'local', projectId: 'project', status: 'active', createdAt: now, updatedAt: now }).run()
    const capture = new FindingCapture({ db: ctx.storage.open(), core: ctx.core, kinds: () => [{ id: 'findings:observation', descriptor: { version: 1, label: 'Observation' } }] })
    await capture.record({ scope: { kind: 'task', taskId: 'task' }, origin: { kind: 'device', deviceId: 'device' }, producerId: 'test', input: { sourceKey: 'one', kind: 'findings:observation', kindVersion: 1, title: 'Keep boundaries', body: 'Use the owner boundary.', claimStatus: 'observed', evidence: [] } })
    await capture.record({ scope: { kind: 'task', taskId: 'task' }, origin: { kind: 'device', deviceId: 'device' }, producerId: 'test', input: { sourceKey: 'two', kind: 'findings:observation', kindVersion: 1, title: 'Keep boundaries', body: 'Use the owner boundary.', claimStatus: 'observed', evidence: [] } })
    runtime = new FindingsRuntime({ capture, emit: () => {}, producerEntries: () => [], targetEntries: () => [{ id: 'memory:change', pluginId: 'memory', value: target }], review: new FindingsReviewStore(ctx.storage.open()), core: ctx.core })
  })
  afterEach(() => ctx.cleanup())
  const request = (principal: Principal, path: string, init?: RequestInit) => portableFetch(findingsReviewRoutes(runtime))(
    new Request(`http://acorn.test${path}`, init),
    { userId: principal.userId, principal, providers: {} } as PluginRequestContext,
  )

  it('refuses task credentials and prepares, edits, dismisses, undoes, snoozes, and lists history for a device', async () => {
    const body = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ boundaryKey: 'manual:task:1' }) }
    expect((await request({ kind: 'internal', userId: 'owner', scope: 'task', taskId: 'task', sessionId: 'session' }, '/tasks/task/review/prepare', body)).status).toBe(403)
    const device: Principal = { kind: 'device', userId: 'owner', deviceId: 'device' }
    const prepared = await request(device, '/tasks/task/review/prepare', body)
    expect(prepared.status).toBe(200)
    expect(await prepared.json()).toMatchObject({ state: 'preparing' })
    type ListedBundle = { id: string; candidates: Array<{ candidateId: string; revision: number; payload: unknown; sourceObservationIds: string[] }> }
    let bundle: ListedBundle | undefined, listed: Response | undefined
    for (let attempt = 0; attempt < 20 && !bundle?.candidates.length; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      listed = await request(device, '/review/bundles?scope=project&projectId=project')
      bundle = (await listed.json() as ListedBundle[])[0]
    }
    expect(bundle).toBeDefined()
    const readyBundle = bundle!
    expect((await request({ kind: 'internal', userId: 'owner', scope: 'task', taskId: 'task', sessionId: 'session' }, `/review/bundles/${readyBundle.id}/retry`, { method: 'POST' })).status).toBe(403)
    expect((await request(device, `/review/bundles/${readyBundle.id}/retry`, { method: 'POST' })).status).toBe(200)
    const id = readyBundle.candidates[0]!.candidateId
    expect(listed?.status).toBe(200)
    const edited = await request(device, `/review/candidates/${id}/edit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 1, payload: { edited: true }, idempotencyKey: 'edit' }) })
    expect(edited.status).toBe(200)
    expect(await edited.json()).toMatchObject({ revision: 2, payload: { edited: true } })
    expect((await request(device, `/review/candidates/${id}/split`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bundleId: readyBundle.id, expectedRevision: 2, observationIds: [readyBundle.candidates[0]!.sourceObservationIds[0]], idempotencyKey: 'split' }) })).status).toBe(200)
    expect((await request(device, `/review/candidates/${id}/decision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 2, action: 'dismiss', idempotencyKey: 'dismiss' }) })).status).toBe(200)
    expect((await request(device, `/review/candidates/${id}/decision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 2, action: 'dismiss-reason', reason: 'task-specific', idempotencyKey: 'dismiss-reason' }) })).status).toBe(200)
    expect((await request(device, `/review/candidates/${id}/decision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 2, action: 'undo-dismiss', idempotencyKey: 'undo' }) })).status).toBe(200)
    expect((await request(device, `/review/candidates/${id}/decision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 2, action: 'snooze', until: Date.now() + 60_000, idempotencyKey: 'snooze' }) })).status).toBe(200)
    const history = await request(device, `/review/candidates/${id}/history`)
    expect((await history.json() as { items: unknown[] }).items).toHaveLength(6)
  })
})
