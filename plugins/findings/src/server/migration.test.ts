import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { FindingsRuntime } from './runtime'
import { FindingsLegacyMigration } from './migration'

const proposal = (id: string, status: 'pending' | 'accepted' | 'rejected', projectId: string | null = 'project') => ({
  id, taskId: 'archived-task', projectId, name: `Name ${id}`, type: 'reference', description: 'Description',
  body: 'Body', flags: ['verified'], originSessionId: 'session', status, createdAt: 123,
})

describe('legacy findings migration', () => {
  let db: TestPluginDb, root: string
  const importLegacyProposal = vi.fn(async (input: { id: string; body: string }) => ({ observationId: `o:${input.id}`, candidateId: `c:${input.id}`, revision: 1, payloadHash: input.body === 'Body' ? `h:${input.id}` : `changed:${input.id}` }))
  const decideCandidate = vi.fn()
  let sourceIds: string[]
  beforeEach(() => { db = makeTestPluginDb('findings'); root = mkdtempSync(join(tmpdir(), 'findings-migration-')); sourceIds = ['o:pending']; importLegacyProposal.mockClear(); decideCandidate.mockClear() })
  afterEach(() => { db.cleanup(); rmSync(root, { recursive: true, force: true }) })

  const migration = () => new FindingsLegacyMigration(db.db, {
    importLegacyProposal,
    candidate: (id: string) => ({ candidateId: id, revision: 1, payloadHash: `h:${id.slice(2)}`, status: 'ready', sourceObservationIds: sourceIds }),
    decideCandidate,
  } as unknown as FindingsRuntime, () => [{ id: 'memory:memory-proposals', value: {
    version: 1,
    list: async () => readdirSync(root).filter((filename) => filename.endsWith('.json')).map((filename) => ({
      filename,
      source: readFileSync(join(root, filename), 'utf8'),
    })),
  } }])

  it('accounts for every status, null reach, and malformed source and resumes by hash', async () => {
    writeFileSync(join(root, 'pending.json'), JSON.stringify(proposal('pending', 'pending', null)))
    writeFileSync(join(root, 'accepted.json'), JSON.stringify(proposal('accepted', 'accepted')))
    writeFileSync(join(root, 'rejected.json'), JSON.stringify(proposal('rejected', 'rejected')))
    writeFileSync(join(root, 'broken.json'), '{not-json')
    const owner = migration()
    const report = await owner.run()
    expect(report).toMatchObject({ files: 4, imported: { pending: 1, accepted: 1, rejected: 1 }, errors: 1, changed: 0, cutoverReady: false })
    expect(importLegacyProposal).toHaveBeenCalledTimes(3)
    await owner.run()
    expect(importLegacyProposal).toHaveBeenCalledTimes(3)
    expect(owner.mapping('pending')).toMatchObject({ oneToOne: true, candidateId: 'c:pending' })
    writeFileSync(join(root, 'broken.json'), JSON.stringify(proposal('repaired', 'pending')))
    expect(await owner.run()).toMatchObject({ imported: { pending: 2, accepted: 1, rejected: 1 }, errors: 0, cutoverReady: true })
    expect(importLegacyProposal).toHaveBeenCalledTimes(4)
  })

  it('blocks cutover when a source changes after import', async () => {
    const path = join(root, 'pending.json')
    writeFileSync(path, JSON.stringify(proposal('pending', 'pending')))
    const owner = migration()
    expect((await owner.run()).cutoverReady).toBe(true)
    writeFileSync(path, JSON.stringify({ ...proposal('pending', 'pending'), body: 'Changed' }))
    expect((await owner.run())).toMatchObject({ cutoverReady: false, changed: 1 })
  })

  it('reconciles a status-only fallback verdict into the existing mapping', async () => {
    const path = join(root, 'pending.json')
    writeFileSync(path, JSON.stringify(proposal('pending', 'pending')))
    const owner = migration()
    await owner.run()
    writeFileSync(path, JSON.stringify(proposal('pending', 'accepted')))
    expect(await owner.run()).toMatchObject({ cutoverReady: true, imported: { pending: 0, accepted: 1, rejected: 0 } })
    expect(owner.mapping('pending')).toMatchObject({ candidateId: 'c:pending', status: 'accepted' })
  })

  it('refuses an old proposal decision after its successor gained grouped evidence', async () => {
    writeFileSync(join(root, 'pending.json'), JSON.stringify(proposal('pending', 'pending')))
    const owner = migration()
    await owner.run()
    sourceIds = ['o:pending', 'o:new-evidence']
    expect(owner.dismissLegacy('pending', 'device')).toBe(false)
    expect(decideCandidate).not.toHaveBeenCalled()
  })
})
