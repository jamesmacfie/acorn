import { createRoot } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import type { DiffSearchMatch, DiffSearchPage, DiffSearchRequest } from '@acorn/diff-document/document'
import { createDiffFindController } from './findController'

const match: DiffSearchMatch = { path: 'a.ts', patchKey: 'sha256:a', ordinal: 3, row: 1, start: 0, end: 6 }

describe('the diff find controller', () => {
  it('reads past pages the source cut short with no matches', async () => {
    vi.useFakeTimers()
    try {
      const cursors: (string | null)[] = []
      const pages: Record<string, DiffSearchPage> = {
        start: { matches: [], nextCursor: 'one' },
        one: { matches: [], nextCursor: 'two' },
        two: { matches: [match], nextCursor: null },
      }
      const search = async (request: DiffSearchRequest) => {
        cursors.push(request.cursor)
        return pages[request.cursor ?? 'start']!
      }
      const revealed: DiffSearchMatch[] = []
      const { find, dispose } = createRoot((dispose) => ({
        dispose,
        find: createDiffFindController({ search, revision: () => 'r1', reveal: (m) => revealed.push(m) }),
      }))
      find.openFind()
      find.setFindQuery('needle')
      await vi.runAllTimersAsync()
      expect(cursors).toEqual([null, 'one', 'two'])
      expect(find.matches()).toEqual([match])
      expect(revealed).toEqual([match])
      dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
