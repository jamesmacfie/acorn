import { describe, expect, it } from 'vitest'
import { fileDocument } from './segment'
import { searchDocument } from './search'

const files = [
  { path: 'a.ts', patchKey: 'sha256:a', patch: '@@ -1,3 +1,3 @@\n const Needle = 1\n-needle needle\n+needleneedle\n tail' },
  { path: 'binary.png', patchKey: null, patch: null },
  { path: 'b.ts', patchKey: 'sha256:b', patch: `@@ -1,200 +1,200 @@\n${Array.from({ length: 200 }, (_, i) => ` line ${i} needle`).join('\n')}` },
]

const loaded: string[] = []
const load = async (file: { path: string; patchKey: string }) => {
  loaded.push(file.path)
  const source = files.find((entry) => entry.path === file.path)!
  return fileDocument(source.path, source.patch).segments
}

describe('searching a document', () => {
  it('finds every occurrence in code rows, by segment and row, and skips files with no patch', async () => {
    const page = await searchDocument(files, load, { query: 'needle', caseSensitive: false, cursor: null }, 1_000)
    expect(page?.nextCursor).toBeNull()
    expect(page?.matches).toHaveLength(1 + 2 + 2 + 200)
    // The hunk header is a row but not text anyone searches, so the first match is row 1.
    expect(page?.matches[0]).toEqual({ path: 'a.ts', patchKey: 'sha256:a', ordinal: 0, row: 1, start: 6, end: 12 })
    expect(page?.matches.some((match) => match.path === 'binary.png')).toBe(false)
  })

  it('respects case when asked', async () => {
    const page = await searchDocument(files, load, { query: 'Needle', caseSensitive: true, cursor: null })
    expect(page?.matches).toHaveLength(1)
  })

  it('pages with a cursor, and a page that fills early reads no further files', async () => {
    loaded.length = 0
    const first = await searchDocument(files, load, { query: 'needle', caseSensitive: false, cursor: null }, 3)
    expect(first?.matches.map((match) => [match.row, match.start])).toEqual([[1, 6], [2, 0], [2, 7]])
    expect(loaded).toEqual(['a.ts'])
    const all = [...first!.matches]
    let cursor = first!.nextCursor
    while (cursor) {
      const next = await searchDocument(files, load, { query: 'needle', caseSensitive: false, cursor }, 50)
      all.push(...next!.matches)
      cursor = next!.nextCursor
    }
    const whole = await searchDocument(files, load, { query: 'needle', caseSensitive: false, cursor: null }, 1_000)
    expect(all).toEqual(whole!.matches)
  })

  it('stops at its segment budget with a cursor, and the pages that follow find the rest', async () => {
    const whole = await searchDocument(files, load, { query: 'needle', caseSensitive: false, cursor: null }, 1_000)
    const all = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page = await searchDocument(files, load, { query: 'needle', caseSensitive: false, cursor }, 1_000, 1)
      all.push(...page!.matches)
      cursor = page!.nextCursor
      pages++
    } while (cursor)
    expect(pages).toBeGreaterThan(2)
    expect(all).toEqual(whole!.matches)
    // A query that matches nothing still answers after one budget, not the whole document.
    const none = await searchDocument(files, load, { query: 'absent', caseSensitive: false, cursor: null }, 1_000, 1)
    expect(none).toMatchObject({ matches: [] })
    expect(none!.nextCursor).not.toBeNull()
  })

  it('reports offsets into the line itself when ignoring case changes its length', async () => {
    const turkish = [{ path: 't.ts', patchKey: 'sha256:t', patch: '@@ -0,0 +1 @@\n+İİ needle' }]
    const page = await searchDocument(turkish, async () => fileDocument('t.ts', turkish[0]!.patch).segments, { query: 'NEEDLE', caseSensitive: false, cursor: null })
    expect(page?.matches.map((match) => [match.start, match.end])).toEqual([[3, 9]])
  })

  it('refuses a cursor it did not write', async () => {
    expect(await searchDocument(files, load, { query: 'needle', caseSensitive: false, cursor: 'nonsense' })).toBeNull()
  })
})
