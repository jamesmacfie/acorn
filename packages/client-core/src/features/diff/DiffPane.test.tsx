import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import type { DiffFile } from '../../kit/diff/diffModel'
import type { DiffSource } from './source'

// What hydrating a large diff costs the list, counted where the cost is: `buildRenderableRows` walks
// every file in the diff and every row in each of them, and the whole viewer — the virtualizer, the
// measure passes, the sticky header — hangs off its result. So the number of times it runs while a
// diff hydrates is the number of times the list rebuilds (docs/diff-rendering.md).
//
// Before phase 8 that was two or three times per file: the hydrator published one version counter, and
// `DiffPane` read every file's status through it inside one memo over all files. Now a status is a
// store key the row itself reads. Parsed files now publish by fetch batch, and off-screen batches may
// coalesce further in an idle turn.
const spy = vi.hoisted(() => ({ rowBuilds: 0, tokenizes: 0 }))

vi.mock('../../kit/diff/diffModel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../kit/diff/diffModel')>()
  return {
    ...actual,
    buildRenderableRows: (...args: Parameters<typeof actual.buildRenderableRows>) => {
      spy.rowBuilds++
      return actual.buildRenderableRows(...args)
    },
  }
})
// The real one spawns a worker and, failing that, loads Shiki and a grammar per file. Neither is what
// this file is about, and both are covered where they live.
vi.mock('../../infra/highlight/worker', () => ({
  tokenizeDocument: async (_path: string, code: string) => {
    spy.tokenizes++
    return code.split('\n').map((line) => [{ content: line, light: '', dark: '' }])
  },
}))

const { DiffPane } = await import('./DiffPane')

const FILES = 200

const file = (index: number): DiffFile => ({
  path: `src/file-${String(index).padStart(3, '0')}.ts`,
  status: 'modified',
  additions: 1,
  deletions: 1,
  sha: `sha-${index}`,
  viewed: false,
  patch: `@@ -1,2 +1,2 @@\n-const a = ${index}\n+const a = ${index + 1}\n context\n`,
})

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose())
  spy.rowBuilds = 0
  spy.tokenizes = 0
  vi.useRealTimers()
})

const mount = (files: DiffFile[]) => {
  const byPath = new Map(files.map((entry) => [entry.path, entry]))
  const source: DiffSource = {
    scope: { routeKey: 'test', kind: 'test' } as unknown as DiffSource['scope'],
    files: () => files,
    loading: () => false,
    signature: () => `sig:${files.length}`,
    selectedPath: () => '',
    cachedFile: (path) => byPath.get(path) ?? null,
    canComment: () => false,
    invalidate: () => {},
    draftPrefix: 'test',
    find: { commandId: 'test.find', description: 'Find', category: 'navigation' },
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  const host = document.createElement('div')
  document.body.append(host)
  cleanups.push(render(() => (
    <QueryClientProvider client={client}><DiffPane source={source} /></QueryClientProvider>
  ), host))
  cleanups.push(() => host.remove())
  return host
}

describe('hydrating a large diff', () => {
  it(`rebuilds the row model at most once per hydration batch`, async () => {
    const files = Array.from({ length: FILES }, (_, index) => file(index))
    mount(files)

    // The hydrator parses in batches of four with an idle wait between them, so a real 200-file diff
    // takes seconds of wall clock. Nothing here depends on real time passing.
    await vi.waitFor(() => expect(spy.tokenizes).toBeGreaterThan(0), { timeout: 4_000 })
    await vi.waitFor(() => expect(spy.tokenizes).toBe(FILES), { timeout: 30_000, interval: 20 })
    // The last file's parse still has to reach the memo.
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Four parsed files publish together, plus the handful of mount-time builds. The previous shape
    // was one rebuild per file, and status transitions before that made it two or three per file.
    expect(spy.rowBuilds).toBeLessThanOrEqual(FILES / 4 + 12)
    expect(spy.rowBuilds).toBeGreaterThan(1)
  }, 40_000)
})
