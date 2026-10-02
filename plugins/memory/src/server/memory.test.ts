import { describe, expect, it } from 'vitest'
import {
  contentHashId,
  parseMemory,
  serializeMemory,
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

describe('memory frontmatter round-trip (docs/notes-and-memory.md — the Claude Code convention)', () => {
  it('serialize → parse preserves the convention fields incl. nested metadata', () => {
    const m = mem({})
    const parsed = parseMemory(serializeMemory(m), 'fallback')
    expect(parsed).toEqual({ ...m, type: 'project' })
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
