import { describe, expect, it } from 'vitest'
import { buildDiffRows, buildRenderableRows, plainTokenize } from '../kit/diff/diffModel'
import { LARGE_SURFACE_PROFILES, largeDiffFiles, largeDiffSummary } from './largeDiff'

// The fixture every large-surface measurement is taken against. Later phases compare numbers across
// commits, so the files a seed produces must not drift silently: the small profile's digest is pinned,
// and a deliberate change to the generator updates it here.

describe('the large-diff fixture', () => {
  it('produces the same files, anchors and identities from the same seed', () => {
    expect(largeDiffSummary('small', 1)).toEqual(largeDiffSummary('small', 1))
    expect(largeDiffSummary('small', 2).digest).not.toBe(largeDiffSummary('small', 1).digest)
    expect(largeDiffSummary('small', 1)).toMatchInlineSnapshot(`
      {
        "digest": "6f144e31",
        "files": 22,
        "fixedRows": 9048,
        "notes": 20,
        "threads": 20,
      }
    `)
  })

  it('counts its rows the way the diff model builds them', () => {
    for (const file of largeDiffFiles('small', 1)) {
      const rows = buildRenderableRows([{ file, diff: buildDiffRows(file, plainTokenize) }], [])
      expect(rows.length, file.path).toBe(file.rows)
    }
  })

  it('anchors every thread and note on a line the model draws', () => {
    for (const file of largeDiffFiles('small', 1)) {
      const rows = buildRenderableRows([{ file, diff: buildDiffRows(file, plainTokenize) }], file.threads)
      expect(rows.filter((row) => row.kind === 'thread')).toHaveLength(file.threads.length)
      const code = rows.flatMap((row) => (row.kind === 'normal' || row.kind === 'insert' || row.kind === 'delete' ? [row] : []))
      for (const note of file.notes) {
        const hit = code.some((row) => (note.side === 'additions' ? row.newNo : row.oldNo) === note.line)
        expect(hit, `${note.path}:${note.side}:${note.line}`).toBe(true)
      }
    }
  })

  it('covers the shapes a real diff has', () => {
    const files = [...largeDiffFiles('scale', 1)]
    const patches = files.map((file) => file.patch ?? '')
    const threads = files.flatMap((file) => file.threads)
    expect(files.some((file) => file.binary && file.patch == null)).toBe(true)
    expect(files.some((file) => file.oldPath)).toBe(true)
    expect(files.some((file) => file.status === 'added' && file.base == null)).toBe(true)
    expect(files.some((file) => file.status === 'removed' && file.head == null)).toBe(true)
    expect(patches.some((patch) => patch.includes('\t'))).toBe(true)
    expect(patches.some((patch) => patch.split('\n').some((line) => line.length > 2_000))).toBe(true)
    expect(patches.some((patch) => (patch.match(/^@@/gm) ?? []).length > 5)).toBe(true)
    // The same text in many places, so nothing may identify a row by its content.
    expect(patches.filter((patch) => patch.includes('+  if (value == null) return fallback')).length).toBeGreaterThan(3)
    expect(new Set(threads.map((thread) => thread.side))).toEqual(new Set(['LEFT', 'RIGHT']))
    expect(threads.some((thread) => thread.resolved) && threads.some((thread) => !thread.resolved)).toBe(true)
    expect(threads.some((thread) => thread.comments.length > 1)).toBe(true)
    const bodies = threads.flatMap((thread) => thread.comments.map((comment) => comment.body ?? ''))
    for (const marker of ['![', '<details>', '```suggestion']) expect(bodies.some((body) => body.includes(marker))).toBe(true)
    expect(new Set(threads.map((thread) => thread.threadId)).size).toBe(threads.length)
  })

  it('meets each profile’s shape, the canonical one streamed rather than held', () => {
    for (const profile of ['small', 'scale'] as const) {
      const shape = LARGE_SURFACE_PROFILES[profile]
      const summary = largeDiffSummary(profile, 1)
      expect(summary.files).toBe(shape.files)
      expect(summary.fixedRows).toBeGreaterThan(shape.rows * 0.8)
      expect(summary.fixedRows).toBeLessThan(shape.rows * 1.25)
      expect(summary.threads).toBe(shape.threads)
      expect(summary.notes).toBe(shape.notes)
    }
    const canonical = largeDiffSummary('canonical', 1)
    expect(canonical.files).toBe(2_200)
    expect(canonical.fixedRows).toBeGreaterThanOrEqual(1_000_000)
    expect(canonical.threads).toBe(400)
  }, 60_000)
})
