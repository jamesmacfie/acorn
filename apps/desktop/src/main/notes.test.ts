import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidSlug, NotesStore, parseNote, serializeNote, slugifyTitle } from './notes'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})

describe('note frontmatter round-trip (docs/notes-and-memory.md)', () => {
  it('serialize → parse preserves meta + body', () => {
    const meta = { title: 'repro steps', author: 'agent' as const, kind: 'finding' as const, originSessionId: 's-1', originTaskId: null, included: true, createdAt: 123 }
    const { meta: parsed, body } = parseNote(serializeNote(meta, '# repro\nsteps here\n'), 'repro-steps')
    expect(parsed).toEqual(meta)
    expect(body).toBe('# repro\nsteps here\n')
  })
  it('included defaults to true when absent, round-trips false, and carries originTaskId', () => {
    expect(parseNote('body only', 's').meta.included).toBe(true) // legacy note → included
    const meta = { title: 't', author: 'user' as const, kind: 'scratch' as const, originSessionId: null, originTaskId: 'task-9', included: false, createdAt: 1 }
    const { meta: parsed } = parseNote(serializeNote(meta, 'x'), 's')
    expect(parsed.included).toBe(false)
    expect(parsed.originTaskId).toBe('task-9')
  })
  it('title derivation: frontmatter → # heading → slug; junk fields degrade safely', () => {
    expect(parseNote('# From Heading\nbody', 'the-slug').meta.title).toBe('From Heading')
    expect(parseNote('no heading at all', 'the-slug').meta.title).toBe('the-slug')
    const { meta } = parseNote('---\nauthor: robot\nkind: novel\n---\nx', 's')
    expect(meta.author).toBe('user')
    expect(meta.kind).toBe('scratch')
  })
  it('slug validation rejects traversal', () => {
    expect(isValidSlug('repro-steps')).toBe(true)
    expect(isValidSlug('..')).toBe(false)
    expect(isValidSlug('a/../b')).toBe(false)
    expect(isValidSlug('.hidden')).toBe(false)
    expect(slugifyTitle('Repro steps: SSO crash!!')).toBe('repro-steps-sso-crash')
    expect(slugifyTitle('!!!')).toBe('note')
  })
})

describe('NotesStore over a temp dir', () => {
  let dir: string
  let store: NotesStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-notes-'))
    store = new NotesStore(dir)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('create/list/read/write/append round-trip with de-duped slugs', async () => {
    const a = await store.create('ws1', 'Agent conventions', { kind: 'plan' })
    expect(a.slug).toBe('agent-conventions')
    const b = await store.create('ws1', 'Agent conventions')
    expect(b.slug).toBe('agent-conventions-2')

    await store.write('ws1', a.slug, '- Prefer spawn_blocking for git.\n')
    await store.append('ws1', a.slug, 'Done: guarded null token.', { author: 'agent', originSessionId: 'sess-9' })
    const note = await store.read('ws1', a.slug)
    expect(note.kind).toBe('plan') // write/append preserve frontmatter
    expect(note.body).toBe('- Prefer spawn_blocking for git.\nDone: guarded null token.\n')

    const list = await store.list('ws1')
    expect(list.map((n) => n.slug).sort()).toEqual(['agent-conventions', 'agent-conventions-2'])
    // A human could edit this by hand: plain frontmatter + markdown.
    expect(readFileSync(join(dir, 'ws1', 'agent-conventions.md'), 'utf8')).toContain('kind: plan')
  })

  it('setIncluded toggles the context flag, preserving body + provenance', async () => {
    const { slug } = await store.create('ws1', 'Seeded PR', { originTaskId: 'task-1', body: 'pr body' })
    expect((await store.read('ws1', slug)).included).toBe(true) // seeded → included by default
    await store.setIncluded('ws1', slug, false)
    const note = await store.read('ws1', slug)
    expect(note.included).toBe(false)
    expect(note.body).toBe('pr body')
    expect(note.originTaskId).toBe('task-1')
    expect((await store.list('ws1')).find((n) => n.slug === slug)?.included).toBe(false)
  })

  it('append creates a missing note with the writer identity (agent findings)', async () => {
    await store.append('ws1', 'findings', 'learned a thing', { author: 'agent', originSessionId: 'sess-1' })
    const note = await store.read('ws1', 'findings')
    expect(note.author).toBe('agent')
    expect(note.kind).toBe('finding')
    expect(note.originSessionId).toBe('sess-1')
  })

  it('atomicity: a failed write leaves no partial file behind', async () => {
    await store.create('ws1', 'safe')
    const before = readFileSync(join(dir, 'ws1', 'safe.md'), 'utf8')
    vi.mocked(rename).mockRejectedValueOnce(new Error('disk full'))
    await expect(store.write('ws1', 'safe', 'new body')).rejects.toThrow('disk full')
    expect(readFileSync(join(dir, 'ws1', 'safe.md'), 'utf8')).toBe(before) // original intact
    expect(readdirSync(join(dir, 'ws1')).filter((f) => f.includes('.tmp'))).toEqual([]) // temp cleaned
  })

  it('rejects traversal slugs and workspace ids at the boundary', async () => {
    await expect(store.read('ws1', '../evil')).rejects.toThrow('Invalid note slug')
    await expect(store.read('../ws', 'x')).rejects.toThrow('Invalid workspace id')
  })
})
