import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryProposalStore } from './memoryProposals'

describe('memory proposals (docs/next 12 — the human gate)', () => {
  let dir: string
  let store: MemoryProposalStore
  let memoryDir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-prop-'))
    memoryDir = join(dir, 'worktree', '.acorn', 'memory')
    mkdirSync(memoryDir, { recursive: true })
    store = new MemoryProposalStore(join(dir, 'proposals'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('propose lands a pending proposal — and NO memory file is written until the gate', async () => {
    const p = await store.propose({
      taskId: 't1',
      repo: 'acme/api',
      name: 'null-token-redirect-guard',
      type: 'fix',
      description: 'SSO login crashed when the token was null before redirect.',
      body: 'Why: the redirect ran before the auth guard; order matters.\n',
      originSessionId: 'sess-9',
    })
    expect(p.status).toBe('pending')
    expect(await store.list('pending')).toHaveLength(1)
    // The gate has not run: the worktree memory dir stays untouched.
    expect(readdirSync(memoryDir)).toEqual([])
    expect(existsSync(join(memoryDir, 'null-token-redirect-guard.md'))).toBe(false)
  })

  it('resolve records the verdict (with optional edits); junk input is rejected', async () => {
    const p = await store.propose({ taskId: 't1', repo: null, name: 'a-fix', type: 'fix', description: 'd', body: 'b', originSessionId: null })
    const accepted = await store.resolve(p.id, 'accepted', { name: 'a-fix', description: 'edited', body: 'b2', type: 'fix' })
    expect(accepted?.status).toBe('accepted')
    expect(accepted?.description).toBe('edited')
    expect((await store.list('pending')).length).toBe(0)
    await expect(store.propose({ taskId: 't', repo: null, name: '../evil', type: 'fix', description: 'd', body: '', originSessionId: null })).rejects.toThrow('Invalid memory name')
    await expect(store.propose({ taskId: 't', repo: null, name: 'ok', type: 'novel' as never, description: 'd', body: '', originSessionId: null })).rejects.toThrow('Invalid memory type')
    expect(await store.resolve('nope', 'rejected')).toBeNull()
  })
})
