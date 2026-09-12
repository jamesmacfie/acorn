import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { FindingCandidateRevision, FindingTargetController, FindingsReviewCapability } from '@acorn/plugin-findings/contract/review.ts'
import { contentHashId, scanMemoryDir, writeMemoryFile, type MemoryRow } from './memory'
import type { MemoryKnowledge } from './knowledgeChannel'
import { createMemoryFindingsTarget } from './findingsReview'
const memoryChangeHash = (payload: unknown): string => createHash('sha256').update(JSON.stringify(payload)).digest('hex')

const candidate = (payload: FindingCandidateRevision['payload'], payloadHash: string): FindingCandidateRevision => ({
  candidateId: 'candidate-1', revision: 1, targetKind: 'memory:change', targetVersion: 1, scope: { kind: 'project', projectId: 'project-1' },
  payload, sourceObservationIds: ['observation-1'], payloadHash, fingerprint: '', subjectKey: '', groupingExplanation: 'One observation.', warnings: [],
  base: null, status: 'ready', snoozedUntil: null, createdAt: 1, updatedAt: 1,
})

describe('memory-owned findings promotion receipts', () => {
  let store: TestPluginDb, home: string
  beforeEach(() => { store = makeTestPluginDb('memory'); home = mkdtempSync(join(tmpdir(), 'acorn-findings-memory-')); mkdirSync(home, { recursive: true }) })
  afterEach(() => { store.cleanup(); rmSync(home, { recursive: true, force: true }) })

  it('writes once, records the durable receipt, and retries only target linkage', async () => {
    const payload = { operation: 'add' as const, name: 'repository-boundaries', type: 'architecture' as const, description: 'Keep repository access behind owners.', body: 'Use the repository owner boundary.', scope: { kind: 'project' as const, projectId: 'project-1' } }
    const row = candidate(payload, memoryChangeHash(payload)); let state: FindingCandidateRevision['status'] = 'ready'
    const memory = {
      reconciled: async () => {},
      list: async () => (await scanMemoryDir({ dir: join(home, '.acorn', 'memory', 'projects', 'project-1'), scope: 'project', projectId: 'project-1' })).map((entry): MemoryRow => ({ ...entry, id: contentHashId(entry.name, entry.body, entry.description), lastAccessedAt: null, accessCount: 0 })),
    } as unknown as MemoryKnowledge
    const findings: FindingsReviewCapability = { candidate: async () => ({ ...row, status: state }), bundles: async () => [], observations: async () => [] }
    const linked = vi.fn().mockRejectedValueOnce(new Error('findings temporarily unavailable')).mockResolvedValue(undefined)
    const controller: FindingTargetController = {
      applying: async () => { state = 'applying'; return { ...row, status: state } },
      applied: async () => { await linked(); state = 'applied'; return { ...row, status: state } },
      conflict: async () => ({ ...row, status: 'conflict' }),
    }
    const target = createMemoryFindingsTarget({ db: store.db, memory, capabilities: { get: () => findings }, homeDir: home, announce: () => {} })
    target.contribution.connect(controller)
    const first = await target.approve({ candidateId: row.candidateId, revision: 1, payloadHash: row.payloadHash, idempotencyKey: 'operation-1', deviceId: 'device-1' })
    expect(first.ok).toBe(true)
    expect(await memory.list({ projectId: 'project-1' })).toHaveLength(1)
    const retry = await target.approve({ candidateId: row.candidateId, revision: 1, payloadHash: row.payloadHash, idempotencyKey: 'operation-1', deviceId: 'device-1' })
    expect(retry).toMatchObject({ ok: true, state: 'applied' })
    expect(await memory.list({ projectId: 'project-1' })).toHaveLength(1)
    expect(linked).toHaveBeenCalledTimes(2)
    expect(await target.approve({ candidateId: row.candidateId, revision: 1, payloadHash: row.payloadHash, idempotencyKey: 'operation-1', deviceId: 'device-2' })).toMatchObject({ ok: false, reason: expect.stringContaining('different approval') })
  })

  it('reconciles an applied update when target linkage failed after replacing its content-addressed base', async () => {
    const dir = join(home, '.acorn', 'memory', 'projects', 'project-1')
    await writeMemoryFile(dir, { name: 'owner-boundaries', type: 'architecture', description: 'Original.', body: 'Original body.', originSessionId: null, commitSha: null, supersededBy: null, createdAt: 1 })
    const memory = {
      reconciled: async () => {},
      list: async () => (await scanMemoryDir({ dir, scope: 'project', projectId: 'project-1' })).map((entry): MemoryRow => ({ ...entry, id: contentHashId(entry.name, entry.body, entry.description), lastAccessedAt: null, accessCount: 0 })),
    } as unknown as MemoryKnowledge
    let row!: FindingCandidateRevision, state: FindingCandidateRevision['status'] = 'ready'
    const findings: FindingsReviewCapability = { candidate: async () => ({ ...row, status: state }), bundles: async () => [], observations: async () => [] }
    const linked = vi.fn().mockRejectedValueOnce(new Error('findings temporarily unavailable')).mockResolvedValue(undefined)
    const target = createMemoryFindingsTarget({ db: store.db, memory, capabilities: { get: () => findings }, homeDir: home, announce: () => {} })
    target.contribution.connect({
      applying: async () => { state = 'applying'; return { ...row, status: state } },
      applied: async () => { await linked(); state = 'applied'; return { ...row, status: state } },
      conflict: async () => ({ ...row, status: 'conflict' }),
    })
    const validated = await target.contribution.validate({ scope: { kind: 'project', projectId: 'project-1' }, payload: { operation: 'add', name: 'owner-boundaries', type: 'architecture', description: 'Revised.', body: 'Revised body.', scope: { kind: 'project', projectId: 'project-1' } } })
    row = { ...candidate(validated.payload, validated.payloadHash), base: validated.base ?? null }

    expect(await target.approve({ candidateId: row.candidateId, revision: 1, payloadHash: row.payloadHash, idempotencyKey: 'operation-update-retry', deviceId: 'device-1' })).toMatchObject({ ok: true, state: 'applied' })
    expect(state).toBe('applying')
    expect((await scanMemoryDir({ dir, scope: 'project', projectId: 'project-1' }))).toHaveLength(1)
    expect(await target.approve({ candidateId: row.candidateId, revision: 1, payloadHash: row.payloadHash, idempotencyKey: 'operation-update', deviceId: 'device-1' })).toMatchObject({ ok: true, state: 'applied' })
    expect(state).toBe('applied')
    expect((await scanMemoryDir({ dir, scope: 'project', projectId: 'project-1' }))).toHaveLength(1)
    expect(linked).toHaveBeenCalledTimes(2)
  })

  it('refuses a changed update base without overwriting the external edit', async () => {
    const dir = join(home, '.acorn', 'memory', 'projects', 'project-1')
    await writeMemoryFile(dir, { name: 'owner-boundaries', type: 'architecture', description: 'Original.', body: 'Original body.', originSessionId: null, commitSha: null, supersededBy: null, createdAt: 1 })
    const memory = { reconciled: async () => {}, list: async () => (await scanMemoryDir({ dir, scope: 'project', projectId: 'project-1' })).map((entry): MemoryRow => ({ ...entry, id: contentHashId(entry.name, entry.body, entry.description), lastAccessedAt: null, accessCount: 0 })) } as unknown as MemoryKnowledge
    let row!: FindingCandidateRevision
    const findings: FindingsReviewCapability = { candidate: async () => row, bundles: async () => [], observations: async () => [] }
    const conflicted = vi.fn(async () => ({ ...row, status: 'conflict' as const }))
    const controller: FindingTargetController = { applying: async () => ({ ...row, status: 'applying' }), applied: async () => ({ ...row, status: 'applied' }), conflict: conflicted }
    const target = createMemoryFindingsTarget({ db: store.db, memory, capabilities: { get: () => findings }, homeDir: home, announce: () => {} })
    target.contribution.connect(controller)
    const validated = await target.contribution.validate({ scope: { kind: 'project', projectId: 'project-1' }, payload: { operation: 'add', name: 'owner-boundaries', type: 'architecture', description: 'Revised.', body: 'Revised body.', scope: { kind: 'project', projectId: 'project-1' } } })
    row = { ...candidate(validated.payload, validated.payloadHash), base: validated.base ?? null }
    await writeMemoryFile(dir, { name: 'owner-boundaries', type: 'architecture', description: 'External edit.', body: 'Do not overwrite.', originSessionId: null, commitSha: null, supersededBy: null, createdAt: 1 })
    const result = await target.approve({ candidateId: row.candidateId, revision: 1, payloadHash: row.payloadHash, idempotencyKey: 'operation-conflict', deviceId: 'device-1' })
    expect(result).toMatchObject({ ok: false })
    expect(conflicted).toHaveBeenCalledOnce()
    expect((await scanMemoryDir({ dir, scope: 'project', projectId: 'project-1' }))[0]?.body).toBe('Do not overwrite.')
  })

  it('detects a type-only base change even though the derived memory ID is unchanged', async () => {
    const dir = join(home, '.acorn', 'memory', 'projects', 'project-1')
    await writeMemoryFile(dir, { name: 'owner-boundaries', type: 'architecture', description: 'Original.', body: 'Original body.', originSessionId: null, commitSha: null, supersededBy: null, createdAt: 1 })
    const memory = { reconciled: async () => {}, list: async () => (await scanMemoryDir({ dir, scope: 'project', projectId: 'project-1' })).map((entry): MemoryRow => ({ ...entry, id: contentHashId(entry.name, entry.body, entry.description), lastAccessedAt: null, accessCount: 0 })) } as unknown as MemoryKnowledge
    let row!: FindingCandidateRevision
    const findings: FindingsReviewCapability = { candidate: async () => row, bundles: async () => [], observations: async () => [] }
    const conflicted = vi.fn(async () => ({ ...row, status: 'conflict' as const }))
    const target = createMemoryFindingsTarget({ db: store.db, memory, capabilities: { get: () => findings }, homeDir: home, announce: () => {} })
    target.contribution.connect({ applying: async () => ({ ...row, status: 'applying' }), applied: async () => ({ ...row, status: 'applied' }), conflict: conflicted })
    const validated = await target.contribution.validate({ scope: { kind: 'project', projectId: 'project-1' }, payload: { operation: 'add', name: 'owner-boundaries', type: 'architecture', description: 'Revised.', body: 'Revised body.', scope: { kind: 'project', projectId: 'project-1' } } })
    row = { ...candidate(validated.payload, validated.payloadHash), base: validated.base ?? null }
    await writeMemoryFile(dir, { name: 'owner-boundaries', type: 'decision', description: 'Original.', body: 'Original body.', originSessionId: null, commitSha: null, supersededBy: null, createdAt: 1 })
    expect(await target.approve({ candidateId: row.candidateId, revision: 1, payloadHash: row.payloadHash, idempotencyKey: 'operation-type-conflict', deviceId: 'device-1' })).toMatchObject({ ok: false })
    expect(conflicted).toHaveBeenCalledOnce()
  })
})
