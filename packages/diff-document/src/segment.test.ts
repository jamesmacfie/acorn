import { describe, expect, it } from 'vitest'
import { documentCache } from './cache'
import { SEGMENT_MAX_BYTES, SEGMENT_MAX_ROWS, segmentContentKey, type DiffDocumentFile, type PlainDiffRow } from './model'
import { parsePatch } from './parse'
import { bandCount, documentTopology, fileDocument, rowBytes, segmentRows } from './segment'

/** mulberry32, so every run cuts the same patches. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A hunks-only patch of about `hunks` hunks, with gaps between some and change runs of every shape. */
function patchOf(seed: number, hunks: number, width = 40): string {
  const next = random(seed)
  const out: string[] = []
  let oldAt = 1 + Math.floor(next() * 20)
  let newAt = oldAt
  for (let h = 0; h < hunks; h++) {
    const lines: string[] = []
    let oldLines = 0
    let newLines = 0
    const blocks = 1 + Math.floor(next() * 12)
    for (let b = 0; b < blocks; b++) {
      for (let i = 0; i < 1 + Math.floor(next() * 3); i++) { lines.push(` ctx ${h}.${b}.${i}`); oldLines++; newLines++ }
      for (let i = 0; i < Math.floor(next() * 6); i++) { lines.push(`-${'d'.repeat(Math.floor(next() * width))}`); oldLines++ }
      for (let i = 0; i < Math.floor(next() * 8); i++) { lines.push(`+${'a'.repeat(Math.floor(next() * width))}`); newLines++ }
    }
    out.push(`@@ -${oldAt},${oldLines} +${newAt},${newLines} @@`, ...lines)
    // Sometimes adjacent, usually a gap.
    const skip = next() < 0.3 ? 0 : 5 + Math.floor(next() * 50)
    oldAt += oldLines + skip
    newAt += newLines + skip
  }
  return out.join('\n')
}

const code = (row: PlainDiffRow) => row.kind === 'normal' || row.kind === 'insert' || row.kind === 'delete'

describe('segmenting a patch', () => {
  const corpus = Array.from({ length: 40 }, (_, seed) => ({ path: `src/file-${seed}.ts`, patch: patchOf(seed + 1, 1 + (seed % 9) * 4, seed % 5 === 0 ? 3_000 : 60) }))

  it('keeps every row, in order, and cuts the same way every time', () => {
    for (const { path, patch } of corpus) {
      const rows = parsePatch(path, patch)
      const doc = fileDocument(path, patch)
      expect(doc.segments.flat()).toEqual(rows)
      expect(fileDocument(path, patch)).toEqual(doc)
    }
  })

  it('bounds every segment by rows and by bytes, except one row that is alone and marked', () => {
    for (const { path, patch } of corpus) {
      const doc = fileDocument(path, patch)
      doc.segments.forEach((segment, ordinal) => {
        const bytes = segment.reduce((sum, row) => sum + rowBytes(row), 0)
        expect(segment.length).toBeLessThanOrEqual(SEGMENT_MAX_ROWS)
        if (doc.descriptors[ordinal]!.oversize) expect(segment).toHaveLength(1)
        else expect(bytes).toBeLessThanOrEqual(SEGMENT_MAX_BYTES)
      })
    }
  })

  it('keeps a split within the byte limit when walking back to the start of a change run', () => {
    const wide = 'x'.repeat(15_000)
    const patch = `@@ -1,3 +1,3 @@\n same\n-${wide}\n-${wide}\n+${wide}\n+${wide}`
    const doc = fileDocument('wide.txt', patch)
    expect(doc.segments.flat()).toEqual(parsePatch('wide.txt', patch))
    doc.segments.forEach((segment, ordinal) => {
      if (doc.descriptors[ordinal]!.oversize) return
      expect(segment.reduce((sum, row) => sum + rowBytes(row), 0)).toBeLessThanOrEqual(SEGMENT_MAX_BYTES)
    })
  })

  it('describes each segment exactly: rows, bands, gaps, columns and line span', () => {
    for (const { path, patch } of corpus) {
      const doc = fileDocument(path, patch)
      doc.segments.forEach((segment, ordinal) => {
        const descriptor = doc.descriptors[ordinal]!
        expect(descriptor.rows).toBe(segment.length)
        expect(descriptor.bands).toBe(bandCount(segment))
        expect(descriptor.gaps).toBe(segment.filter((row) => row.kind === 'gap').length)
        const lines = segment.filter(code).flatMap((row) => (row.kind === 'hunk' || row.kind === 'gap' ? [] : [row.raw.length]))
        expect(descriptor.columns).toBe(Math.max(0, ...lines))
        const newNos = segment.flatMap((row) => (code(row) && 'newNo' in row && row.newNo != null ? [row.newNo] : []))
        expect(descriptor.lines[2]).toBe(newNos[0] ?? 0)
        expect(descriptor.lines[3]).toBe(newNos[newNos.length - 1] ?? 0)
      })
    }
  })

  it('puts a gap only at the edge of a segment', () => {
    for (const { path, patch } of corpus) {
      for (const segment of fileDocument(path, patch).segments) {
        segment.forEach((row, at) => {
          if (row.kind !== 'gap') return
          if (row.side === 'bottom') expect(at === 0 || at === segment.length - 1).toBe(true)
          else expect(at).toBe(0)
        })
      }
    }
  })

  it('does not split a deletion run from its insertions when there is room to cut before it', () => {
    const rows: PlainDiffRow[] = [
      { kind: 'hunk', text: '@@ -1,70 +1,70 @@' },
      ...Array.from({ length: 40 }, (_, i): PlainDiffRow => ({ kind: 'normal', oldNo: i + 1, newNo: i + 1, raw: 'x' })),
      ...Array.from({ length: 20 }, (_, i): PlainDiffRow => ({ kind: 'delete', oldNo: 41 + i, newNo: null, raw: 'old' })),
      ...Array.from({ length: 20 }, (_, i): PlainDiffRow => ({ kind: 'insert', oldNo: null, newNo: 41 + i, raw: 'new' })),
    ]
    const { segments } = segmentRows(rows)
    expect(segments.map((segment) => segment.length)).toEqual([41, 40])
    expect(segments[1]![0]!.kind).toBe('delete')
  })

  it('keeps a row larger than the byte budget whole, alone, and marked', () => {
    const huge = 'x'.repeat(SEGMENT_MAX_BYTES * 2)
    const doc = fileDocument('min.js', `@@ -1,1 +1,1 @@\n-a\n+${huge}\n b`)
    const at = doc.segments.findIndex((segment) => segment.some((row) => row.kind === 'insert'))
    expect(doc.segments[at]).toEqual([{ kind: 'insert', oldNo: null, newNo: 1, raw: huge }])
    expect(doc.descriptors[at]!.oversize).toBe(true)
    expect(doc.descriptors.filter((descriptor) => descriptor.oversize)).toHaveLength(1)
  })

  it('falls back to raw lines for a patch the parser cannot read, still bounded', () => {
    const garbage = Array.from({ length: 500 }, (_, i) => `not a diff line ${i}`).join('\n')
    const doc = fileDocument('odd.txt', garbage)
    expect(doc.segments.flat()).toHaveLength(500)
    expect(doc.segments.every((segment) => segment.length <= SEGMENT_MAX_ROWS)).toBe(true)
    expect(doc.segments.flat().every((row) => row.kind === 'normal' && row.oldNo == null)).toBe(true)
  })

  it('draws no rows for a file with no patch', () => {
    expect(fileDocument('logo.png', null)).toEqual({ segments: [], descriptors: [], bytes: 0 })
    expect(fileDocument('empty.ts', '')).toEqual({ segments: [], descriptors: [], bytes: 0 })
  })
})

describe('segment and document identity', () => {
  const file = (path: string, patchKey: string | null, patch: string): DiffDocumentFile => ({
    path, status: 'modified', additions: 0, deletions: 0, sha: null, viewed: false, patchKey,
    segments: fileDocument(path, patch).descriptors,
  })

  it('keys a segment by its patch and ordinal, never by its position in the document', () => {
    const a = file('a.ts', 'sha256:aaa', patchOf(3, 6))
    const b = file('b.ts', 'sha256:bbb', patchOf(4, 6))
    const alone = documentTopology([b])
    const after = documentTopology([a, b])
    // The same file's descriptors and keys, whatever comes before it.
    expect(after.files[1]!.segments).toEqual(alone.files[0]!.segments)
    expect(segmentContentKey('sha256:bbb', 2)).toBe(segmentContentKey('sha256:bbb', 2))
    // And the revision moves, because the document did.
    expect(after.revision).not.toBe(alone.revision)
    expect(after.totals).toMatchObject({ files: 2, segments: a.segments.length + b.segments.length })
  })

  it('keys the same new file differently when its patch differs', () => {
    expect(segmentContentKey('sha256:against-main', 0)).not.toBe(segmentContentKey('sha256:against-release', 0))
    expect(documentTopology([file('a.ts', 'sha256:one', '@@ -1 +1 @@\n+x')]).revision)
      .not.toBe(documentTopology([file('a.ts', 'sha256:two', '@@ -1 +1 @@\n+x')]).revision)
  })
})

describe('the parsed-file cache', () => {
  it('drops the least recently used file past its byte budget and keeps the newest', () => {
    const doc = (bytes: number) => ({ segments: [], descriptors: [], bytes })
    const cache = documentCache(100)
    cache.set('a', doc(40))
    cache.set('b', doc(40))
    cache.get('a')
    cache.set('c', doc(40))
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBeDefined()
    cache.set('huge', doc(500))
    expect(cache.stats()).toEqual({ entries: 1, bytes: 500 })
  })
})
