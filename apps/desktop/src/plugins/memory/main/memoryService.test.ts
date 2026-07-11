import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestDb, type TestDb } from '../../../core/server/routes/testDb'
import { schema } from '../../../core/server/db'
import { reconcileMemories } from './memory'
import { MemoryProposalStore } from './memoryProposals'
import { MemoryService } from './memoryService'

const TASK = '33333333-3333-4333-8333-333333333333'
let repoDir: string | null = null
vi.mock('../../../core/main/taskWorktree', () => ({ taskRoot: async () => repoDir }))

describe('MemoryService', () => {
  let t: TestDb
  let dir: string
  let proposalsDir: string
  let svc: MemoryService

  beforeEach(async () => {
    t = makeTestDb()
    dir = mkdtempSync(join(tmpdir(), 'acorn-mem-repo-'))
    proposalsDir = mkdtempSync(join(tmpdir(), 'acorn-mem-prop-'))
    repoDir = dir
    await t.db.insert(schema.tasks).values({
      id: TASK, title: 'T', origin: 'local', repoOwner: 'o', repoName: 'r', branch: 'main',
      status: 'active', sort: 0, createdAt: 1, updatedAt: 1,
    })
    const reconcile = () => reconcileMemories(t.db, [{ dir: join(dir, '.acorn', 'memory'), scope: 'repo', repo: 'o/r' }])
    svc = new MemoryService({ db: t.db, proposals: new MemoryProposalStore(proposalsDir), reconcile })
  })
  afterEach(() => {
    repoDir = null
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
    rmSync(proposalsDir, { recursive: true, force: true })
  })

  it('creates a repo-scoped entry, lists it, and finds it by search', async () => {
    const entry = await svc.createEntry(TASK, {
      scope: 'repo', name: 'db-batching', description: 'batch writes', type: 'convention', body: 'Always batch DB writes for throughput.',
    })
    expect(entry.name).toBe('db-batching')
    expect(entry.repo).toBe('o/r')

    const list = await svc.listEntries({ repo: 'o/r' })
    expect(list.map((e) => e.name)).toContain('db-batching')

    const hits = await svc.search({ query: 'batch throughput', limit: 10 })
    expect(hits.map((h) => h.name)).toContain('db-batching')
  })

  it('rejects repo-scoped creation without a worktree', async () => {
    repoDir = null
    await expect(
      svc.createEntry(TASK, { scope: 'repo', name: 'x', description: 'd', type: 'fix', body: 'b' }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('lists and rejects a proposal', async () => {
    const store = new MemoryProposalStore(proposalsDir)
    const p = await store.propose({ taskId: TASK, repo: 'o/r', name: 'maybe-fact', type: 'fix', description: 'd', body: 'b', originSessionId: null })

    const proposals = await svc.listProposals({ taskId: TASK })
    expect(proposals.map((x) => x.id)).toContain(p.id)

    const res = await svc.resolveProposal(p.id, { approved: false })
    expect(res).toEqual({ resolved: true, status: 'rejected' })
    expect((await store.get(p.id))?.status).toBe('rejected')
  })

  it('404s resolving an unknown proposal', async () => {
    await expect(svc.resolveProposal('nope', { approved: false })).rejects.toMatchObject({ code: 'not_found' })
  })
})
