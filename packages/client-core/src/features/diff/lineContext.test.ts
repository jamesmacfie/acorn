import { describe, expect, it, vi } from 'vitest'
import type { DiffSource } from './source.ts'
import type { CodeRow } from '../../kit/diff/diffModel.ts'
import type { DiffSegmentRequest } from '@acorn/diff-document/document'
import { loadDiffLineContext } from './lineContext.ts'

describe('diff line context', () => {
  it('loads only the anchor segment and bounds the excerpt', async () => {
    const loadSegments = vi.fn(async (_requests: DiffSegmentRequest[]) => [{
      path: 'src/a.ts', patchKey: 'patch-a', ordinal: 1,
      rows: Array.from({ length: 12 }, (_, index) => ({
        kind: 'insert' as const, oldNo: null, newNo: index + 1, raw: `line ${index + 1}`,
      })),
    }])
    const source = {
      topology: () => ({ files: [{ path: 'src/a.ts', patchKey: 'patch-a', segments: [
        { lines: [0, 0, 50, 60] }, { lines: [0, 0, 1, 12] },
      ] }] }),
      loadSegments,
    } as unknown as DiffSource
    const row = { path: 'src/a.ts', kind: 'insert', oldNo: null, newNo: 6, raw: 'line 6' } as CodeRow
    const excerpt = await loadDiffLineContext(source, row)
    expect(loadSegments).toHaveBeenCalledOnce()
    expect(loadSegments.mock.calls[0]?.[0]).toEqual([{ path: 'src/a.ts', patchKey: 'patch-a', ordinal: 1 }])
    expect(excerpt).toContain('+:6 line 6')
    expect(excerpt).not.toContain('line 2')
    expect(excerpt).not.toContain('line 10')
  })
})
