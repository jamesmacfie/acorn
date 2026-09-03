import { createEffect, createMemo, createRoot } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import type { DiffFile, ParsedFile } from './diffModel'
import { createDiffHydrator } from './hydration'

// The hydrator's reactivity, which its `.test.ts` beside this file cannot reach: that project runs in
// bare Node against Solid's server build, where a store notifies nobody. Everything else about the
// hydrator — the queue, the batching, the statuses as values — is tested there.
//
// What this file holds is the property the phase-8 change is for: a publish touches one file
// (docs/diff-rendering.md § Parsing and highlighting).

const pullFile = (path: string, patch: string | null): DiffFile => ({
  path,
  status: 'modified',
  additions: 1,
  deletions: 1,
  sha: `sha-${path}`,
  viewed: false,
  patch,
})

describe('a hydration publish', () => {
  it('notifies the file that changed, and only that file', async () => {
    const parsed: ParsedFile[] = []
    let disposeRoot!: () => void
    const hydrator = createRoot((dispose) => {
      disposeRoot = dispose
      return createDiffHydrator({ parseFile: (file) => ({ file, diff: [] }), onParsed: (file) => parsed.push(file) })
    })
    const runs = { a: 0, b: 0 }

    try {
      let stopWatching!: () => void
      createRoot((dispose) => {
        stopWatching = dispose
        // A memo per file, which is the shape a row reads its own status with. Each is driven by an
        // effect, because a memo nobody reads never recomputes.
        const a = createMemo(() => { runs.a++; return hydrator.status('src/a.ts') })
        const b = createMemo(() => { runs.b++; return hydrator.status('src/b.ts') })
        createEffect(() => { a(); b() })
      })
      await vi.waitFor(() => expect(runs.a).toBe(1))

      hydrator.reset([pullFile('src/a.ts', '@@ a'), pullFile('src/b.ts', '@@ b')], 'src/a.ts')
      await vi.waitFor(() => {
        expect(hydrator.status('src/a.ts')).toBe('loaded')
        expect(hydrator.status('src/b.ts')).toBe('loaded')
      })
      await vi.waitFor(() => expect(runs.b).toBeGreaterThan(1))
      const hydrated = { ...runs }

      hydrator.retry('src/a.ts')
      await vi.waitFor(() => expect(runs.a).toBeGreaterThan(hydrated.a))
      // The point of the change: b's memo did not re-run for a's retry, and a version counter would
      // have re-run it for every one of a's transitions.
      expect(runs.b).toBe(hydrated.b)
      stopWatching()
    } finally {
      hydrator.dispose()
      disposeRoot()
    }
  })
})
