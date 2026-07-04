import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildHeadlessArgv, runHeadless } from './headless'
import { contentHashId } from './memory'
import { acceptProposal, generateMemoryProposals, rejectProposal, verifyCandidates, MEMORY_REVIEW_SCHEMA, type MemoryCandidate, type MemoryGenDeps } from './memoryGen'
import { MemoryProposalStore } from './memoryProposals'

const FAKE_AGENT = resolve(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/fake-agent.sh')

const candidate = (over: Partial<MemoryCandidate>): MemoryCandidate => ({
  name: 'null-token-redirect-guard',
  type: 'fix',
  description: 'SSO login crashed when the token was null before redirect.',
  body: '**Why:** the redirect ran before the auth guard; order matters.\n',
  refs: ['src/auth/login.ts'],
  ...over,
})

describe('verifyCandidates (the 3 checks, docs/next 12 P3)', () => {
  const ctx = {
    fileExists: (p: string) => p === 'src/auth/login.ts',
    existingIds: new Set([contentHashId('known-memory', 'body', 'desc')]),
    existingByName: new Map([['auth-conventions', { description: 'old take', body: 'old body' }]]),
  }
  it('a dangling file-ref BLOCKS', () => {
    const [v] = verifyCandidates([candidate({ refs: ['src/gone.ts'] })], ctx)
    expect(v.blocking).toEqual(['references a missing file: src/gone.ts'])
  })
  it('a duplicate content-hash BLOCKS', () => {
    const [v] = verifyCandidates([candidate({ name: 'known-memory', body: 'body', description: 'desc', refs: [] })], ctx)
    expect(v.blocking[0]).toContain('duplicate')
  })
  it('a same-name different-content memory FLAGS (contradiction), not blocks', () => {
    const [v] = verifyCandidates([candidate({ name: 'auth-conventions', refs: [] })], ctx)
    expect(v.blocking).toEqual([])
    expect(v.flags[0]).toContain('contradicts')
  })
  it('a clean candidate passes untouched', () => {
    const [v] = verifyCandidates([candidate({})], ctx)
    expect(v.blocking).toEqual([])
    expect(v.flags).toEqual([])
  })
})

describe('the pipeline over the fake agent + real proposal store (docs/next 12 P3)', () => {
  let dir: string
  let worktree: string
  let store: MemoryProposalStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-mgen-'))
    worktree = join(dir, 'wt')
    mkdirSync(join(worktree, 'src', 'auth'), { recursive: true })
    writeFileSync(join(worktree, 'src', 'auth', 'login.ts'), 'x')
    store = new MemoryProposalStore(join(dir, 'proposals'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const memoryDir = () => join(worktree, '.acorn', 'memory')

  const deps = (structured: string): MemoryGenDeps => ({
    runReview: (prompt, schema) => {
      expect(schema).toBe(MEMORY_REVIEW_SCHEMA)
      expect(prompt).toContain('## Task diff')
      const argv = buildHeadlessArgv('claude-code', FAKE_AGENT, { prompt, schema })!
      return runHeadless(argv, { cwd: dir, env: { PATH: process.env.PATH ?? '', FAKE_AGENT_STRUCTURED: structured } })
    },
    taskDiff: async () => '+ guarded the token in src/auth/login.ts',
    transcriptTail: async () => 'agent: fixed the redirect order',
    existingIndex: async () => [],
    fileExists: (p) => existsSync(join(worktree, p)),
    propose: async (c, flags) =>
      void (await store.propose({
        taskId: 't1',
        repo: 'acme/api',
        name: c.name,
        type: c.type,
        description: flags.length ? `${c.description} [${flags.join('; ')}]` : c.description,
        body: c.body,
        originSessionId: 'sess-1',
      })),
  })

  const REVIEW = JSON.stringify({
    memories: [
      { name: 'null-token-redirect-guard', type: 'fix', description: 'Guard order matters.', body: '**Why:** redirect before guard.', refs: ['src/auth/login.ts'] },
      { name: 'dangling', type: 'reference', description: 'cites a ghost', body: 'x', refs: ['src/gone.ts'] },
    ],
  })

  it('review → verify → proposals: dangling ref rejected, clean one filed; NOTHING on disk before accept', async () => {
    const out = await generateMemoryProposals(deps(REVIEW))
    expect(out.proposed).toBe(1)
    expect(out.rejected).toEqual([{ name: 'dangling', issues: ['references a missing file: src/gone.ts'] }])
    expect((await store.list('pending')).map((p) => p.name)).toEqual(['null-token-redirect-guard'])
    // The gate has not run — no memory dir, no files.
    expect(existsSync(memoryDir())).toBe(false)
  })

  it('accept writes the file + MEMORY.md + reconciles; reject leaves no trace', async () => {
    await generateMemoryProposals(deps(REVIEW))
    const [pending] = await store.list('pending')
    let reconciled = 0
    const res = await acceptProposal(store, pending.id, worktree, async () => void reconciled++, {
      name: pending.name,
      type: 'fix',
      description: 'Edited at the gate.',
      body: pending.body,
    })
    expect(res).toEqual({ ok: true })
    expect(reconciled).toBe(1) // the index row lands via reconcile
    const file = readFileSync(join(memoryDir(), 'null-token-redirect-guard.md'), 'utf8')
    expect(file).toContain('description: Edited at the gate.')
    expect(file).toContain('originSessionId: sess-1') // provenance carried
    expect(readFileSync(join(memoryDir(), 'MEMORY.md'), 'utf8')).toContain('null-token-redirect-guard')
    expect((await store.get(pending.id))?.status).toBe('accepted')

    // Reject path on a fresh proposal: no disk writes, verdict recorded.
    await generateMemoryProposals(deps(JSON.stringify({ memories: [{ name: 'to-reject', type: 'decision', description: 'd', body: 'b' }] })))
    const rej = (await store.list('pending')).find((p) => p.name === 'to-reject')!
    await rejectProposal(store, rej.id)
    expect(readdirSync(memoryDir()).some((f) => f.includes('to-reject'))).toBe(false)
    expect((await store.get(rej.id))?.status).toBe('rejected')
  })

  it('a gone worktree fails accept cleanly (memory never lands in the primary checkout)', async () => {
    await generateMemoryProposals(deps(REVIEW))
    const [pending] = await store.list('pending')
    const res = await acceptProposal(store, pending.id, join(dir, 'nope'), async () => {})
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('worktree is gone')
    expect((await store.get(pending.id))?.status).toBe('pending') // still gated
  })

  it('a failing review step reports a typed error; an idle task proposes nothing', async () => {
    const failing = deps(REVIEW)
    failing.runReview = (prompt, schema) => {
      const argv = buildHeadlessArgv('claude-code', FAKE_AGENT, { prompt, schema })!
      return runHeadless(argv, { cwd: dir, env: { PATH: process.env.PATH ?? '', FAKE_AGENT_MODE: 'fail' } })
    }
    expect((await generateMemoryProposals(failing)).error).toContain('error')

    const idle = deps(REVIEW)
    idle.taskDiff = async () => ''
    idle.transcriptTail = async () => ''
    expect(await generateMemoryProposals(idle)).toEqual({ proposed: 0, rejected: [] })
  })
})
