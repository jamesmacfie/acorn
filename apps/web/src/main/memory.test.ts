import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, type TestDb } from '../server/routes/testDb'
import {
  contentHashId,
  listMemories,
  memoryIndexSlice,
  parseMemory,
  reconcileMemories,
  renderMemoryIndex,
  searchMemories,
  serializeMemory,
  writeMemoryFile,
  type MemoryFile,
} from './memory'

const mem = (over: Partial<MemoryFile>): MemoryFile => ({
  name: 'auth-conventions',
  description: 'how auth flows work in this repo',
  type: 'convention',
  originSessionId: 'sess-1',
  commitSha: 'abc123',
  supersededBy: null,
  createdAt: 1000,
  body: 'Tokens rotate hourly.\n\n**Why:** the SSO provider expires them.\n\nSee [[login-flow]].\n',
  ...over,
})

describe('memory frontmatter round-trip (docs/next 12 — the Claude Code convention)', () => {
  it('serialize → parse preserves the convention fields incl. nested metadata', () => {
    const m = mem({})
    const parsed = parseMemory(serializeMemory(m), 'fallback')
    expect(parsed).toEqual(m)
  })
  it('degrades junk safely: bad type → reference, missing description → first body line', () => {
    const parsed = parseMemory('---\nname: x\nmetadata:\n  type: novel\n---\nThe first line.\nmore', 'x')
    expect(parsed.type).toBe('reference')
    expect(parsed.description).toBe('The first line.')
  })
  it('content-hash ids are stable and content-sensitive', () => {
    expect(contentHashId('a', 'b', 'c')).toBe(contentHashId('a', 'b', 'c'))
    expect(contentHashId('a', 'b', 'c')).not.toBe(contentHashId('a', 'B', 'c'))
  })
})

describe('memory store + index over temp checkouts', () => {
  let dir: string
  let t: TestDb
  let checkoutA: string
  let checkoutB: string
  let home: string

  const sources = () => [
    { dir: join(checkoutA, '.acorn', 'memory'), scope: 'repo' as const, repo: 'acme/api' },
    { dir: join(checkoutB, '.acorn', 'memory'), scope: 'repo' as const, repo: 'acme/api' },
    { dir: join(home, '.acorn', 'memory'), scope: 'private' as const, repo: null },
  ]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-mem-'))
    checkoutA = join(dir, 'a')
    checkoutB = join(dir, 'b')
    home = join(dir, 'home')
    for (const d of [checkoutA, checkoutB, home]) mkdirSync(join(d, '.acorn', 'memory'), { recursive: true })
    t = makeTestDb()
  })

  afterEach(() => {
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('writeMemoryFile lands the file + regenerates MEMORY.md; reconcile indexes it', async () => {
    const memDir = join(checkoutA, '.acorn', 'memory')
    await writeMemoryFile(memDir, mem({}))
    await writeMemoryFile(memDir, mem({ name: 'login-flow', description: 'the login redirect order', type: 'architecture' }))
    const index = readFileSync(join(memDir, 'MEMORY.md'), 'utf8')
    expect(index).toBe('- [auth-conventions](auth-conventions.md) — how auth flows work in this repo\n- [login-flow](login-flow.md) — the login redirect order\n')

    await reconcileMemories(t.db, sources())
    const all = await listMemories(t.db, {})
    expect(all.map((m) => m.name)).toEqual(['auth-conventions', 'login-flow'])
  })

  it('reconcile follows add/edit/delete', async () => {
    const memDir = join(checkoutA, '.acorn', 'memory')
    await writeMemoryFile(memDir, mem({}))
    await reconcileMemories(t.db, sources())
    expect((await listMemories(t.db, {})).length).toBe(1)

    await writeMemoryFile(memDir, mem({ description: 'edited description' }))
    await reconcileMemories(t.db, sources())
    const [row] = await listMemories(t.db, {})
    expect(row.description).toBe('edited description')

    rmSync(join(memDir, 'auth-conventions.md'))
    await reconcileMemories(t.db, sources())
    expect(await listMemories(t.db, {})).toEqual([])
  })

  it('content-hash dedupe across two checkouts; different bodies → newest updatedAt wins', async () => {
    // Identical file in both checkouts → one row.
    await writeMemoryFile(join(checkoutA, '.acorn', 'memory'), mem({}))
    await writeMemoryFile(join(checkoutB, '.acorn', 'memory'), mem({}))
    await reconcileMemories(t.db, sources())
    expect((await listMemories(t.db, {})).length).toBe(1)

    // Divergent copies of the same name: the newer mtime wins.
    await writeMemoryFile(join(checkoutB, '.acorn', 'memory'), mem({ description: 'NEWER take on auth' }))
    const old = new Date(Date.now() - 60_000)
    utimesSync(join(checkoutA, '.acorn', 'memory', 'auth-conventions.md'), old, old)
    await reconcileMemories(t.db, sources())
    const rows = await listMemories(t.db, {})
    expect(rows).toHaveLength(1)
    expect(rows[0].description).toBe('NEWER take on auth')
  })

  it('FTS search ranks by BM25 with the repo-scope filter (private rides along)', async () => {
    await writeMemoryFile(join(checkoutA, '.acorn', 'memory'), mem({}))
    await writeMemoryFile(join(checkoutA, '.acorn', 'memory'), mem({ name: 'db-layout', description: 'tables and mirrors', type: 'architecture', body: 'The pull mirror caches PRs.\n' }))
    await writeMemoryFile(join(home, '.acorn', 'memory'), mem({ name: 'my-shortcuts', description: 'private auth shortcuts', type: 'user', body: 'Auth token helper on my machine.\n' }))
    writeFileSync(
      join(checkoutB, '.acorn', 'memory', 'other-repo.md'),
      serializeMemory(mem({ name: 'other-repo', description: 'auth notes for another repo' })),
    )
    const src = [...sources().slice(0, 1), { dir: join(checkoutB, '.acorn', 'memory'), scope: 'repo' as const, repo: 'zzz/other' }, sources()[2]]
    await reconcileMemories(t.db, src)

    const hits = await searchMemories(t.db, 'auth token', { repo: 'acme/api' })
    expect(hits.map((h) => h.name)).toContain('auth-conventions')
    expect(hits.map((h) => h.name)).toContain('my-shortcuts') // private scope rides along
    expect(hits.map((h) => h.name)).not.toContain('other-repo') // other repo filtered out
    // Porter stemming: 'rotating' matches 'rotate'.
    expect((await searchMemories(t.db, 'rotating tokens', { repo: 'acme/api' }))[0]?.name).toBe('auth-conventions')
    // FTS syntax can't be injected.
    expect(await searchMemories(t.db, '"unclosed OR (', { repo: 'acme/api' })).toEqual([])
    // Type filter.
    expect((await searchMemories(t.db, 'auth', { repo: 'acme/api', type: 'user' })).map((h) => h.name)).toEqual(['my-shortcuts'])
  })

  it('memoryIndexSlice returns the injection index; renderMemoryIndex is stable-sorted', async () => {
    await writeMemoryFile(join(checkoutA, '.acorn', 'memory'), mem({}))
    await reconcileMemories(t.db, sources())
    expect(await memoryIndexSlice(t.db, 'acme/api')).toEqual([{ name: 'auth-conventions', description: 'how auth flows work in this repo' }])
    expect(renderMemoryIndex([])).toBe('')
  })
})
